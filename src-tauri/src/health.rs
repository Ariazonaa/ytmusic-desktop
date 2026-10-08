//! What currently does not work, for the settings window to show: parts of
//! YouTube Music's page the app could not find, and errors of plugins.
//!
//! The report comes from the YouTube Music page, so it is cut down to a
//! bounded size and to plain text before it is kept.

use crate::settings::is_valid_name;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};

const MAX_PROBLEMS: usize = 24;
const MAX_PROBLEM_CHARS: usize = 80;
const MAX_PLUGINS: usize = 64;
const MAX_ERRORS_PER_PLUGIN: usize = 5;
const MAX_ERROR_CHARS: usize = 300;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Health {
    /// Parts of the page that were not found, by the name the frontend gives them.
    pub page_problems: Vec<String>,
    /// The latest errors of each plugin, newest last.
    pub plugin_errors: BTreeMap<String, Vec<String>>,
}

impl Health {
    /// The report with everything dropped or cut that does not fit.
    pub fn bounded(self) -> Self {
        let clean = |text: &str, max: usize| -> String {
            text.chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .take(max)
                .collect::<String>()
                .trim()
                .to_owned()
        };
        let page_problems = self
            .page_problems
            .iter()
            .map(|problem| clean(problem, MAX_PROBLEM_CHARS))
            .filter(|problem| !problem.is_empty())
            .take(MAX_PROBLEMS)
            .collect();
        let plugin_errors = self
            .plugin_errors
            .into_iter()
            .filter(|(plugin, _)| is_valid_name(plugin))
            .take(MAX_PLUGINS)
            .filter_map(|(plugin, errors)| {
                // The newest errors are the ones worth keeping.
                let skip = errors.len().saturating_sub(MAX_ERRORS_PER_PLUGIN);
                let kept: Vec<String> = errors
                    .iter()
                    .skip(skip)
                    .map(|error| clean(error, MAX_ERROR_CHARS))
                    .filter(|error| !error.is_empty())
                    .collect();
                (!kept.is_empty()).then_some((plugin, kept))
            })
            .collect();
        Self {
            page_problems,
            plugin_errors,
        }
    }
}

/// The latest report, shared between the commands.
#[derive(Default)]
pub struct HealthStore(Mutex<Health>);

impl HealthStore {
    pub fn get(&self) -> Health {
        self.lock().clone()
    }

    pub fn set(&self, health: Health) {
        *self.lock() = health.bounded();
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Health> {
        self.0.lock().unwrap_or_else(|err| err.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn errors(plugin: &str, messages: &[&str]) -> BTreeMap<String, Vec<String>> {
        BTreeMap::from([(
            plugin.to_owned(),
            messages.iter().map(|m| (*m).to_owned()).collect(),
        )])
    }

    #[test]
    fn keeps_a_normal_report() {
        let health = Health {
            page_problems: vec!["volumeSlider".into()],
            plugin_errors: errors("lyrics", &["failed in onSongChange: boom"]),
        };
        assert_eq!(health.clone().bounded(), health);
    }

    #[test]
    fn keeps_the_newest_errors_and_cuts_long_ones() {
        let many: Vec<String> = (0..9).map(|n| format!("error {n}")).collect();
        let health = Health {
            page_problems: vec![],
            plugin_errors: BTreeMap::from([("demo".to_owned(), many)]),
        }
        .bounded();
        assert_eq!(
            health.plugin_errors["demo"],
            ["error 4", "error 5", "error 6", "error 7", "error 8"]
        );

        let long = Health {
            page_problems: vec!["x".repeat(500)],
            plugin_errors: errors("demo", &[&"y".repeat(5000)]),
        }
        .bounded();
        assert_eq!(long.page_problems[0].len(), MAX_PROBLEM_CHARS);
        assert_eq!(long.plugin_errors["demo"][0].len(), MAX_ERROR_CHARS);
    }

    #[test]
    fn drops_what_does_not_belong() {
        let mut plugin_errors = errors("Not A Plugin", &["x"]);
        plugin_errors.insert("empty".into(), vec![" \n ".into()]);
        plugin_errors.insert("ok".into(), vec!["line\none".into()]);
        let health = Health {
            page_problems: (0..100)
                .map(|n| format!("problem {n}"))
                .chain(["".into()])
                .collect(),
            plugin_errors,
        }
        .bounded();
        assert_eq!(health.page_problems.len(), MAX_PROBLEMS);
        assert_eq!(health.plugin_errors, errors("ok", &["line one"]));
    }

    #[test]
    fn the_store_bounds_what_it_is_given() {
        let store = HealthStore::default();
        assert_eq!(store.get(), Health::default());
        store.set(Health {
            page_problems: vec!["a".repeat(200)],
            plugin_errors: BTreeMap::new(),
        });
        assert_eq!(store.get().page_problems[0].len(), MAX_PROBLEM_CHARS);
    }
}
