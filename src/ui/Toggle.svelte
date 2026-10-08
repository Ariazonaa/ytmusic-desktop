<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    checked: boolean;
    onchange: (checked: boolean) => void;
    children: Snippet;
  }
  let { checked, onchange, children }: Props = $props();
</script>

<label class="flex cursor-pointer items-center justify-between gap-4 py-3">
  <span class="min-w-0">{@render children()}</span>
  <input
    type="checkbox"
    role="switch"
    class="peer sr-only"
    {checked}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span
    class="relative h-6 w-11 shrink-0 rounded-full bg-neutral-700 transition-colors
      after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white
      after:transition-transform peer-checked:bg-red-600 peer-checked:after:translate-x-5
      peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-white"
  ></span>
</label>
