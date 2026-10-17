<script lang="ts">
  import { onMount } from "svelte";
  import { Dropdown, type DropdownOption } from "../shared/dropdown";

  interface Props {
    /** What the control is for, for screen readers. */
    label: string;
    options: DropdownOption[];
    value: string;
    onchange: (value: string) => void;
  }
  let { label, options, value, onchange }: Props = $props();

  let host: HTMLElement;
  let dropdown: Dropdown | undefined;

  onMount(() => {
    dropdown = new Dropdown(document, { label, onChange: (chosen) => onchange(chosen) });
    host.append(dropdown.element);
    return () => dropdown?.element.remove();
  });

  $effect(() => {
    if (!dropdown) return;
    dropdown.setOptions(options);
    dropdown.value = value;
  });
</script>

<div class="w-44 shrink-0" bind:this={host}></div>
