<script lang="ts">
  import type { Translate } from "./i18n";
  import { describeShortcut, shortcutFrom } from "../shared/shortcut";

  interface Props {
    t: Translate;
    label: string;
    /** A second, dimmed line under the label. */
    description?: string | undefined;
    value: string;
    onchange: (shortcut: string) => void;
  }
  let { t, label, description, value, onchange }: Props = $props();

  /** True while the field waits for the user to press a combination. */
  let recording = $state(false);

  function onkeydown(event: KeyboardEvent): void {
    if (!recording) return;
    event.preventDefault();
    if (event.code === "Escape") {
      recording = false;
      return;
    }
    const shortcut = shortcutFrom(event);
    if (shortcut) {
      recording = false;
      onchange(shortcut);
    }
  }
</script>

<div class="flex items-center justify-between gap-3 py-3">
  <span class="min-w-0">
    <span class="block {description ? '' : 'font-medium'}">{label}</span>
    {#if description}
      <span class="block text-neutral-400">{description}</span>
    {/if}
  </span>
  <span class="flex shrink-0 items-center gap-2">
    <button
      type="button"
      class="w-44 rounded-md border px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-white
        {recording ? 'border-red-600 bg-neutral-950 text-neutral-300' : 'border-neutral-700 bg-neutral-950'}"
      aria-label={t("{label} shortcut", { label })}
      onclick={() => (recording = !recording)}
      onblur={() => (recording = false)}
      {onkeydown}
    >
      {recording ? t("Press the keys…") : value === "" ? t("Not set") : describeShortcut(value)}
    </button>
    <button
      type="button"
      class="rounded-md border border-neutral-700 px-2 py-1.5 hover:bg-neutral-800 disabled:opacity-40
        focus-visible:outline-2 focus-visible:outline-white"
      disabled={value === ""}
      onclick={() => onchange("")}
    >
      {t("Clear")}
    </button>
  </span>
</div>
