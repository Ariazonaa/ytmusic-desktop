//! Downloads over HTTPS, with the HTTP client tauri-plugin-updater brings,
//! so that nothing new is built for it.

use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(60);

/// Downloads `url`, at most `max` bytes.
pub async fn fetch(url: &str, max: usize) -> Result<Vec<u8>, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(TIMEOUT)
        // Release files on GitHub are served from another host.
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(concat!("ytmusic-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("cannot reach {url}: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        if bytes.len() + chunk.len() > max {
            return Err(format!("{url} is larger than {} kB", max / 1024));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
