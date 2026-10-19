//! Security keys for the Google sign-in on Linux.
//!
//! WebKitGTK is built without Web Authentication: the page finds no
//! `navigator.credentials.get` and Google waits forever at "Use your security
//! key". The injected script (`src/core/injector/webauthn.ts`) stands in for
//! the browser and hands the request here, where the key is asked over USB.
//!
//! The browser's part of the checks happens here as well: the origin is the
//! one of the page the window shows, never one the script names, and the page
//! may only ask for credentials of its own site.
// Only Linux uses it; the tests run everywhere.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// The only page that may use a security key through the app.
pub const SIGN_IN_HOST: &str = "accounts.google.com";
/// The U2F App ID of keys registered with Google before Web Authentication.
/// Browsers accept it from Google's sign-in, though it is on another host.
const GOOGLE_APP_ID: &str = "https://www.gstatic.com/securitykey/origins.json";
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 300_000;

/// What the page passes to `navigator.credentials.get`, binary values as
/// base64url.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRequest {
    challenge: String,
    rp_id: Option<String>,
    #[serde(default)]
    allow_credentials: Vec<String>,
    user_verification: Option<String>,
    timeout: Option<u64>,
    app_id: Option<String>,
    /// The PIN of the key, once the key asked for one.
    pin: Option<String>,
}

/// The parts of an `AuthenticatorAssertionResponse`, as base64url.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assertion {
    id: String,
    client_data_json: String,
    authenticator_data: String,
    signature: String,
    user_handle: Option<String>,
    /// Whether the key answered for the App ID instead of the site.
    app_id_used: bool,
}

/// Why a request failed. `Display` gives what the script turns into a
/// `DOMException`: the exception's name, then a message.
#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    /// The page asked for something it may not have.
    Security(&'static str),
    /// The request is malformed.
    Invalid(&'static str),
    /// No key, no touch in time, or the key refused.
    NotAllowed(String),
    /// The key wants its PIN; the script asks the user and tries again.
    PinRequired,
    /// The PIN was wrong, with the attempts the key has left.
    PinInvalid(Option<u8>),
    PinBlocked,
    /// The page cancelled the request.
    Aborted,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Security(message) => write!(f, "SecurityError: {message}"),
            Self::Invalid(message) => write!(f, "TypeError: {message}"),
            Self::NotAllowed(message) => write!(f, "NotAllowedError: {message}"),
            Self::PinRequired => write!(f, "PinRequired"),
            Self::PinInvalid(Some(retries)) => write!(f, "PinInvalid: {retries}"),
            Self::PinInvalid(None) => write!(f, "PinInvalid"),
            Self::PinBlocked => write!(f, "NotAllowedError: the security key is locked"),
            Self::Aborted => write!(f, "AbortError: the request was cancelled"),
        }
    }
}

/// A request checked against the page that made it, ready for the key.
#[derive(Debug, PartialEq, Eq)]
struct Checked {
    origin: String,
    rp_id: String,
    client_data_json: String,
    allow_list: Vec<Vec<u8>>,
    app_id: Option<String>,
    timeout_ms: u64,
}

fn decode(value: &str) -> Result<Vec<u8>, Failure> {
    // Padding is not expected, but harmless.
    URL_SAFE_NO_PAD
        .decode(value.trim_end_matches('='))
        .map_err(|_| Failure::Invalid("not base64url"))
}

fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Checks a request from the page at `page`, and writes the client data the
/// key signs.
fn check(page: &tauri::Url, request: &GetRequest) -> Result<Checked, Failure> {
    if page.scheme() != "https" || page.host_str() != Some(SIGN_IN_HOST) || page.port().is_some() {
        return Err(Failure::Security(
            "only the Google sign-in may use a security key",
        ));
    }
    let host = SIGN_IN_HOST;
    let origin = format!("https://{host}");
    // The site's own host or a domain above it, as long as that is more than
    // a top-level domain.
    let rp_id = request.rp_id.clone().unwrap_or_else(|| host.to_string());
    let below = host
        .strip_suffix(rp_id.as_str())
        .is_some_and(|rest| rest.ends_with('.'));
    if !(rp_id == host || below && rp_id.contains('.')) {
        return Err(Failure::Security("the relying party is not this site"));
    }
    let app_id = match request.app_id.as_deref() {
        None => None,
        Some(GOOGLE_APP_ID) => Some(GOOGLE_APP_ID.to_string()),
        Some(_) => return Err(Failure::Security("the App ID is not this site's")),
    };
    let challenge = decode(&request.challenge)?;
    if challenge.len() < 16 {
        return Err(Failure::Invalid("the challenge is too short"));
    }
    let allow_list = request
        .allow_credentials
        .iter()
        .map(|id| decode(id))
        .collect::<Result<Vec<_>, _>>()?;
    // Serialized by hand: the members' order is the one browsers write.
    let client_data_json = format!(
        r#"{{"type":"webauthn.get","challenge":{},"origin":{},"crossOrigin":false}}"#,
        serde_json::Value::from(encode(&challenge)),
        serde_json::Value::from(origin.as_str()),
    );
    let timeout_ms = request
        .timeout
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS);
    Ok(Checked {
        origin,
        rp_id,
        client_data_json,
        allow_list,
        app_id,
        timeout_ms,
    })
}

#[cfg(target_os = "linux")]
pub use device::{cancel, get, WebAuthn};

#[cfg(target_os = "linux")]
mod device {
    use super::*;
    use authenticator::authenticatorservice::{AuthenticatorService, SignArgs};
    use authenticator::ctap2::server::{
        AuthenticationExtensionsClientInputs, PublicKeyCredentialDescriptor, Transport,
        UserVerificationRequirement,
    };
    use authenticator::errors::AuthenticatorError;
    use authenticator::statecallback::StateCallback;
    use authenticator::{Pin, PinError, StatusPinUv, StatusUpdate};
    use sha2::{Digest, Sha256};
    use std::sync::mpsc::channel;
    use std::sync::{Arc, Mutex};

    /// The connection to the keys, made on first use. One request at a time.
    #[derive(Default)]
    pub struct WebAuthn(Mutex<Option<AuthenticatorService>>);

    impl WebAuthn {
        fn with_service<T>(
            &self,
            f: impl FnOnce(&mut AuthenticatorService) -> T,
        ) -> Result<T, Failure> {
            let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());
            if guard.is_none() {
                let mut service = AuthenticatorService::new().map_err(|err| {
                    Failure::NotAllowed(format!("no access to security keys: {err}"))
                })?;
                service.add_u2f_usb_hid_platform_transports();
                *guard = Some(service);
            }
            Ok(f(guard.as_mut().expect("the service was just made")))
        }
    }

    /// Cancels the running request, if any.
    pub fn cancel(state: &WebAuthn) {
        let _ = state.with_service(|service| {
            // Fails only when nothing runs.
            let _ = service.cancel();
        });
    }

    /// What the key said about its PIN while the request ran.
    #[derive(Clone, Copy)]
    enum PinState {
        Required,
        Invalid(Option<u8>),
    }

    /// Asks a key to sign in at the page `page`. Blocks until the key answers.
    pub fn get(
        state: &WebAuthn,
        page: &tauri::Url,
        request: GetRequest,
    ) -> Result<Assertion, Failure> {
        let checked = check(page, &request)?;
        let client_data_hash: [u8; 32] = Sha256::digest(checked.client_data_json.as_bytes()).into();
        let allow_list: Vec<PublicKeyCredentialDescriptor> = checked
            .allow_list
            .iter()
            .map(|id| PublicKeyCredentialDescriptor {
                id: id.clone(),
                transports: vec![Transport::USB],
            })
            .collect();
        let user_verification_req = match request.user_verification.as_deref() {
            Some("required") => UserVerificationRequirement::Required,
            Some("discouraged") => UserVerificationRequirement::Discouraged,
            _ => UserVerificationRequirement::Preferred,
        };
        let args = SignArgs {
            client_data_hash,
            origin: checked.origin.clone(),
            relying_party_id: checked.rp_id.clone(),
            allow_list: allow_list.clone(),
            user_verification_req,
            user_presence_req: true,
            extensions: AuthenticationExtensionsClientInputs {
                app_id: checked.app_id.clone(),
                ..Default::default()
            },
            pin: request.pin.as_deref().map(Pin::new),
            use_ctap1_fallback: false,
        };

        // A PIN the key asks for is not answered here: the request ends, and
        // the script asks the user and sends the request again with it.
        let pin_state: Arc<Mutex<Option<PinState>>> = Arc::default();
        let (status_tx, status_rx) = channel::<StatusUpdate>();
        let status_pin = Arc::clone(&pin_state);
        std::thread::spawn(move || {
            let record =
                |value| *status_pin.lock().unwrap_or_else(|err| err.into_inner()) = Some(value);
            // Ends when the request is done and drops its sender.
            while let Ok(update) = status_rx.recv() {
                match update {
                    StatusUpdate::PinUvError(StatusPinUv::PinRequired(_)) => {
                        record(PinState::Required)
                    }
                    StatusUpdate::PinUvError(StatusPinUv::InvalidPin(_, retries)) => {
                        record(PinState::Invalid(retries))
                    }
                    // Several accounts on the key: the first, as the page
                    // cannot be asked. Google keeps one per key.
                    StatusUpdate::SelectResultNotice(choice, _) => {
                        let _ = choice.send(Some(0));
                    }
                    _ => {}
                }
            }
        });

        let (result_tx, result_rx) = channel();
        let callback = StateCallback::new(Box::new(move |result| {
            let _ = result_tx.send(result);
        }));
        // A request still running for a page that went away ends now.
        state
            .with_service(|service| {
                let _ = service.cancel();
                service.sign(checked.timeout_ms, args, status_tx, callback)
            })?
            .map_err(|err| Failure::NotAllowed(err.to_string()))?;
        let result = result_rx
            .recv()
            .map_err(|_| Failure::NotAllowed("the security key did not answer".into()))?;

        let signed = match result {
            Ok(signed) => signed,
            Err(err) => {
                // A PIN asked for ends the request once the status loop
                // above has dropped the key's question, so it is recorded by
                // then. A blocked PIN ends it at once, with this error.
                let pin = *pin_state.lock().unwrap_or_else(|err| err.into_inner());
                return Err(match (pin, err) {
                    (
                        _,
                        AuthenticatorError::PinError(
                            PinError::PinBlocked | PinError::PinAuthBlocked,
                        ),
                    ) => Failure::PinBlocked,
                    (Some(PinState::Invalid(retries)), _) => Failure::PinInvalid(retries),
                    (Some(PinState::Required), _) => Failure::PinRequired,
                    (None, AuthenticatorError::CancelledByUser) => Failure::Aborted,
                    // Also the end of the time the page gave, or a cancel.
                    (None, err) => Failure::NotAllowed(err.to_string()),
                });
            }
        };
        let assertion = signed.assertion;
        // A key that knows only one credential may leave out which it used.
        let id = match (assertion.credentials, allow_list.as_slice()) {
            (Some(credential), _) => credential.id,
            (None, [only]) => only.id.clone(),
            (None, _) => {
                return Err(Failure::NotAllowed(
                    "the key did not say which credential it used".into(),
                ))
            }
        };
        Ok(Assertion {
            id: encode(&id),
            client_data_json: encode(checked.client_data_json.as_bytes()),
            authenticator_data: encode(&assertion.auth_data.to_vec()),
            signature: encode(&assertion.signature),
            user_handle: assertion.user.map(|user| encode(&user.id)),
            app_id_used: signed.extensions.app_id == Some(true),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(rp_id: Option<&str>, app_id: Option<&str>) -> GetRequest {
        GetRequest {
            challenge: encode(&[7; 32]),
            rp_id: rp_id.map(str::to_string),
            allow_credentials: vec![encode(b"key")],
            user_verification: None,
            timeout: None,
            app_id: app_id.map(str::to_string),
            pin: None,
        }
    }

    fn page(url: &str) -> tauri::Url {
        url.parse().unwrap()
    }

    #[test]
    fn google_sign_in_may_ask_for_its_own_site() {
        let sign_in = page("https://accounts.google.com/v3/signin/challenge/sk");
        for rp_id in [None, Some("accounts.google.com"), Some("google.com")] {
            let checked = check(&sign_in, &request(rp_id, None)).unwrap();
            assert_eq!(checked.origin, "https://accounts.google.com");
            assert_eq!(checked.allow_list, vec![b"key".to_vec()]);
        }
        let checked = check(&sign_in, &request(None, Some(GOOGLE_APP_ID))).unwrap();
        assert_eq!(checked.app_id.as_deref(), Some(GOOGLE_APP_ID));
    }

    #[test]
    fn client_data_is_what_browsers_write() {
        let sign_in = page("https://accounts.google.com/");
        let checked = check(&sign_in, &request(None, None)).unwrap();
        assert_eq!(
            checked.client_data_json,
            format!(
                r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://accounts.google.com","crossOrigin":false}}"#,
                encode(&[7; 32])
            )
        );
    }

    #[test]
    fn other_sites_and_relying_parties_are_refused() {
        let sign_in = page("https://accounts.google.com/");
        for rp_id in [
            "com",
            "evil.com",
            "ccounts.google.com",
            "google.com.evil",
            "youtube.com",
        ] {
            assert!(
                matches!(
                    check(&sign_in, &request(Some(rp_id), None)),
                    Err(Failure::Security(_))
                ),
                "{rp_id}"
            );
        }
        assert!(matches!(
            check(
                &sign_in,
                &request(None, Some("https://evil.example/origins.json"))
            ),
            Err(Failure::Security(_))
        ));
        for url in [
            "https://music.youtube.com/",
            "http://accounts.google.com/",
            "https://accounts.google.com:8443/",
            "https://accounts.google.de/",
        ] {
            assert!(
                matches!(
                    check(&page(url), &request(None, None)),
                    Err(Failure::Security(_))
                ),
                "{url}"
            );
        }
    }

    #[test]
    fn malformed_requests_are_refused() {
        let sign_in = page("https://accounts.google.com/");
        let mut short = request(None, None);
        short.challenge = encode(b"short");
        assert!(matches!(check(&sign_in, &short), Err(Failure::Invalid(_))));
        let mut garbage = request(None, None);
        garbage.allow_credentials = vec!["not base64!".into()];
        assert!(matches!(
            check(&sign_in, &garbage),
            Err(Failure::Invalid(_))
        ));
    }

    #[test]
    fn failures_name_their_exception() {
        assert_eq!(Failure::PinInvalid(Some(3)).to_string(), "PinInvalid: 3");
        assert_eq!(Failure::PinRequired.to_string(), "PinRequired");
        assert!(Failure::Aborted.to_string().starts_with("AbortError: "));
    }
}
