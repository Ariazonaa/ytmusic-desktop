<script lang="ts">
  import type { PluginSettingValues, SettingField, SettingValue } from "../shared/types";
  import type { Translate } from "./i18n";
  import ShortcutField from "./ShortcutField.svelte";
  import Toggle from "./Toggle.svelte";

  interface Props {
    t: Translate;
    schema: Record<string, SettingField>;
    values: PluginSettingValues;
    onchange: (key: string, value: SettingValue) => void;
    /** Puts every setting shown here back to its default. */
    onreset: () => void;
  }
  let { t, schema, values, onchange, onreset }: Props = $props();

  const shown = $derived(Object.entries(schema).filter(([, field]) => !field.hidden));
  const changed = $derived(shown.some(([key, field]) => values[key] !== field.default));

  const inputClass =
    "w-44 shrink-0 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-neutral-100 " +
    "focus-visible:outline-2 focus-visible:outline-white";

  function changeNumber(key: string, field: SettingField & { type: "number" }, input: HTMLInputElement) {
    const value = input.valueAsNumber;
    const valid =
      Number.isFinite(value) &&
      (field.min === undefined || value >= field.min) &&
      (field.max === undefined || value <= field.max);
    if (valid) onchange(key, value);
    else input.value = String(values[key]);
  }
</script>

<div class="mb-3 rounded-md bg-neutral-950/60 px-3">
  {#each shown as [key, field] (key)}
    {#snippet text()}
      <span class="block">{t(field.label)}</span>
      {#if field.description}
        <span class="block text-neutral-400">{t(field.description)}</span>
      {/if}
    {/snippet}

    {#if field.type === "shortcut"}
      <ShortcutField
        {t}
        label={t(field.label)}
        description={field.description ? t(field.description) : undefined}
        value={String(values[key] ?? "")}
        onchange={(shortcut) => onchange(key, shortcut)}
      />
    {:else if field.type === "boolean"}
      <Toggle checked={values[key] === true} onchange={(checked) => onchange(key, checked)}>
        {@render text()}
      </Toggle>
    {:else if field.type === "text"}
      <label class="block py-3">
        <span class="mb-2 block">{@render text()}</span>
        <textarea
          class="block h-32 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5
            font-mono text-xs text-neutral-100 focus-visible:outline-2 focus-visible:outline-white"
          spellcheck="false"
          value={String(values[key] ?? "")}
          onchange={(event) => onchange(key, event.currentTarget.value)}
        ></textarea>
      </label>
    {:else}
      <label class="flex items-center justify-between gap-4 py-3">
        <span class="min-w-0">{@render text()}</span>
        {#if field.type === "select"}
          <select
            class={inputClass}
            value={values[key]}
            onchange={(event) => onchange(key, event.currentTarget.value)}
          >
            {#each field.options as option (option.value)}
              <option value={option.value}>{t(option.label)}</option>
            {/each}
          </select>
        {:else if field.type === "range"}
          <span class="flex w-44 shrink-0 items-center gap-2">
            <input
              type="range"
              class="min-w-0 flex-1 accent-red-600"
              min={field.min}
              max={field.max}
              step={field.step ?? "any"}
              value={values[key]}
              onchange={(event) => onchange(key, event.currentTarget.valueAsNumber)}
            />
            <output class="w-14 text-right text-neutral-300 tabular-nums">
              {values[key]}{field.unit ? ` ${t(field.unit)}` : ""}
            </output>
          </span>
        {:else if field.type === "color"}
          <input
            type="color"
            class="h-9 w-44 shrink-0 cursor-pointer rounded-md border border-neutral-700 bg-neutral-950 p-1
              focus-visible:outline-2 focus-visible:outline-white"
            value={values[key]}
            onchange={(event) => onchange(key, event.currentTarget.value)}
          />
        {:else if field.type === "number"}
          <input
            type="number"
            class={inputClass}
            min={field.min}
            max={field.max}
            value={values[key]}
            onchange={(event) => changeNumber(key, field, event.currentTarget)}
          />
        {:else}
          <input
            type="text"
            class={inputClass}
            value={values[key]}
            onchange={(event) => onchange(key, event.currentTarget.value)}
          />
        {/if}
      </label>
    {/if}
  {/each}
  <div class="flex justify-end py-2">
    <button
      type="button"
      class="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40
        focus-visible:outline-2 focus-visible:outline-white"
      disabled={!changed}
      onclick={onreset}
    >
      {t("Reset to defaults")}
    </button>
  </div>
</div>
