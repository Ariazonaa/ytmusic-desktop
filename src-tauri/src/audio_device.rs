//! The name of the device sound currently goes to, so that the equalizer can
//! remember a preset for each pair of headphones or speakers.

const MAX_NAME_CHARS: usize = 120;

/// One line of bounded length, whatever the system reports.
fn clean(name: &str) -> Option<String> {
    let line: String = name
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let cleaned: String = line
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// The name Windows shows for the default output device, e.g.
/// `Headphones (WH-1000XM4)`. `None` if there is no output device.
#[cfg(windows)]
pub fn default_output_name() -> Option<String> {
    use windows::Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
            STGM_READ,
        },
    };

    // SAFETY: plain COM calls with valid arguments. COM is set up for this
    // thread first and taken down again only if this call set it up; a thread
    // that already had it in another mode works as well.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let name = (|| -> windows::core::Result<String> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let properties = device.OpenPropertyStore(STGM_READ)?;
            Ok(properties.GetValue(&PKEY_Device_FriendlyName)?.to_string())
        })();
        if initialized {
            CoUninitialize();
        }
        name.ok().as_deref().and_then(clean)
    }
}

/// Not found out on other systems yet.
#[cfg(not(windows))]
pub fn default_output_name() -> Option<String> {
    let _ = clean;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_a_reported_name() {
        assert_eq!(
            clean("  Headphones\n(WH-1000XM4)\t"),
            Some("Headphones (WH-1000XM4)".into())
        );
        assert_eq!(clean(" \n "), None);
        assert_eq!(clean(&"x".repeat(500)).unwrap().len(), MAX_NAME_CHARS);
    }

    #[cfg(windows)]
    #[test]
    fn asking_twice_gives_the_same_answer() {
        // A machine without a sound device answers `None` both times.
        assert_eq!(default_output_name(), default_output_name());
    }
}
