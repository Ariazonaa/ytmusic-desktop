<script lang="ts">
  // How the Discord status looks with the current settings: what Discord was
  // last asked to show, or a sample track while it shows nothing.
  import appIcon from "../../src-tauri/icons/128x128.png";
  import { discordPreview, type DiscordPreview } from "../core/settings/client";
  import { activityFor, SAMPLE_SONG, SAMPLE_STATE, SAMPLE_VIDEO_ID } from "../plugins/discord/activity";
  import type { PluginSettingValues } from "../shared/types";
  import type { Translate } from "./i18n";

  interface Props {
    t: Translate;
    values: PluginSettingValues;
  }
  let { t, values }: Props = $props();

  let preview = $state<DiscordPreview | null>(null);
  let live = $state(false);
  let now = $state(Date.now());

  async function refresh(): Promise<void> {
    try {
      const shown = await discordPreview(null);
      if (shown) {
        preview = shown;
        live = true;
        return;
      }
      // The sample plays, whatever the setting for pauses, so that there is something to see.
      const sample = activityFor(SAMPLE_SONG, SAMPLE_STATE, SAMPLE_VIDEO_ID, "like", values, t, Date.now());
      preview = sample && (await discordPreview(sample));
      live = false;
    } catch {
      preview = null;
    }
  }

  $effect(() => {
    // Again whenever a setting changes, and every second for the progress.
    void values;
    void refresh();
    const timer = setInterval(() => {
      now = Date.now();
      void refresh();
    }, 1000);
    return () => clearInterval(timer);
  });

  const clock = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const memberName = $derived(
    !preview
      ? ""
      : preview.status_display_type === 1
        ? preview.state
        : preview.status_display_type === 2
          ? preview.details
          : "YouTube Music",
  );
  const progress = $derived.by(() => {
    const times = preview?.timestamps;
    if (!times) return null;
    const elapsed = Math.max(0, now - times.start);
    const total = times.end ? times.end - times.start : null;
    return {
      elapsed: clock(total ? Math.min(elapsed, total) : elapsed),
      total: total ? clock(total) : null,
      share: total ? Math.min(1, elapsed / total) : 0,
    };
  });
</script>

<section class="mb-3" aria-label={t("Preview")}>
  <p class="mb-1 text-xs text-neutral-400">
    {live ? t("Preview: what Discord shows right now.") : t("Preview with a sample track: Discord shows nothing right now.")}
  </p>
  {#if preview}
    <div class="rounded-lg bg-[#232428] p-3 text-[#dbdee1]">
      <p class="text-xs font-semibold">{t("Listening to {name} now", { name: "YouTube Music" })}</p>
      <div class="mt-2 flex gap-3">
        <div class="relative size-16 shrink-0">
          {#if preview.assets.large_image}
            <img
              src={preview.assets.large_image}
              alt=""
              title={preview.assets.large_text}
              class="size-16 rounded-md object-cover"
            />
          {:else}
            <div class="size-16 rounded-md bg-[#2b2d31]"></div>
          {/if}
          {#if preview.assets.small_image}
            <img
              src={appIcon}
              alt=""
              title={preview.assets.small_text}
              class="absolute -right-1.5 -bottom-1.5 size-6 rounded-full border-2 border-[#232428] bg-[#232428]"
            />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold {preview.details_url ? 'underline decoration-dotted' : ''}">
            {preview.details}
          </p>
          <p class="truncate text-sm {preview.state_url ? 'underline decoration-dotted' : ''}">{preview.state}</p>
          {#if progress}
            <div class="mt-1.5 flex items-center gap-2 text-xs tabular-nums">
              <span>{progress.elapsed}</span>
              <div class="h-1 flex-1 rounded-full bg-[#4e5058]">
                <div class="h-1 rounded-full bg-[#dbdee1]" style="width: {progress.share * 100}%"></div>
              </div>
              {#if progress.total}<span>{progress.total}</span>{/if}
            </div>
          {/if}
        </div>
      </div>
      {#if preview.assets.small_text}
        <p class="mt-2 text-xs text-[#949ba4]">{t("On the small icon: {text}", { text: preview.assets.small_text })}</p>
      {/if}
      {#each preview.buttons ?? [] as button (button.label)}
        <div class="mt-2 rounded-md bg-[#4e5058] py-1.5 text-center text-sm font-medium" title={button.url}>
          {button.label}
        </div>
      {/each}
      <div class="mt-3 flex items-center gap-2 border-t border-[#3f4147] pt-2 text-xs">
        <span class="size-6 shrink-0 rounded-full bg-[#5865f2]"></span>
        <span class="min-w-0">
          <span class="block font-semibold">{t("You, in the member list")}</span>
          <span class="block truncate text-[#949ba4]">♫ {t("Listening to {name}", { name: memberName })}</span>
        </span>
      </div>
    </div>
    <p class="mt-1 text-xs text-neutral-500">
      {t("The buttons show to others only; Discord leaves them out of your own profile.")}
    </p>
  {/if}
</section>
