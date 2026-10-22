import { BANNER_COLOURS, bannerStatus, formatLondon, isoToLondonInput, MAX_BANNER_MESSAGE, type Banner } from "@/lib/banners";
import { adminListBanners } from "@/lib/config-store";
import { deleteBannerAction, saveBannerAction } from "../actions";
import { Flash } from "../Flash";
import { gate } from "../gate";
import { BannerStrip } from "./BannerStrip";
import styles from "../admin.module.css";

type SearchParams = Promise<{ notice?: string; error?: string }>;

/** The news banners shown above the map: make one, switch it on or off, set when it shows. */
export default async function BannersPage({ searchParams }: { searchParams: SearchParams }) {
  const blocked = await gate();
  if (blocked) return blocked;

  const { notice, error } = await searchParams;
  let banners: Banner[];
  try {
    banners = await adminListBanners();
  } catch (error) {
    console.error("[admin]", error instanceof Error ? error.message : error);
    return <p className={styles.error}>Could not reach the database. Check DATABASE_URL and try again.</p>;
  }

  return (
    <>
      <Flash notice={notice} error={error} />
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>New banner</h2>
        <BannerForm />
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Banners</h2>
        <p className={styles.help}>
          A banner shows above the map while it is on and between its start and end. Several at once take turns.
        </p>
        {banners.length === 0 && <p className={styles.help}>No banners yet.</p>}
        {banners.map((banner) => (
          <details key={banner.id} className={styles.bannerItem}>
            <summary>
              <BannerStrip banner={banner} />
              <span className={styles.help}>{statusText(banner)}</span>
            </summary>
            <BannerForm banner={banner} />
          </details>
        ))}
      </section>
    </>
  );
}

function statusText(banner: Banner): string {
  const status = bannerStatus(banner);
  const times = [
    banner.startsAt && `from ${formatLondon(banner.startsAt)}`,
    banner.endsAt && `until ${formatLondon(banner.endsAt)}`,
  ].filter(Boolean);
  const label = { showing: "Showing now", scheduled: "Scheduled", ended: "Ended", off: "Off" }[status];
  return [label, ...times].join(" · ");
}

function BannerForm({ banner }: { banner?: Banner }) {
  const id = banner ? `banner-${banner.id}` : "banner-new";
  return (
    <form action={saveBannerAction} className={styles.cardPlain}>
      {banner && <input type="hidden" name="id" value={banner.id} />}
      <label className={styles.field}>
        <span>Message</span>
        <input
          name="message"
          defaultValue={banner?.message ?? ""}
          placeholder="e.g. Watford Junction train station is currently closed"
          required
          maxLength={MAX_BANNER_MESSAGE}
        />
      </label>

      <fieldset className={styles.colours}>
        <legend>Colour</legend>
        {BANNER_COLOURS.map((option) => (
          <label key={option.key} className={styles.swatch} title={option.label}>
            <input type="radio" name="colour" value={option.key} defaultChecked={(banner?.colour ?? "navy") === option.key} />
            <span style={{ background: option.background }}>
              <span className={styles.visuallyHidden}>{option.label}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className={styles.field}>
        <span>Link (optional)</span>
        <input name="link" type="url" defaultValue={banner?.link ?? ""} placeholder="https://" maxLength={300} />
      </label>

      <div className={styles.dates}>
        <label className={styles.field} htmlFor={`${id}-start`}>
          <span>Starts (UK time; empty = now)</span>
          <input id={`${id}-start`} name="startsAt" type="datetime-local" defaultValue={isoToLondonInput(banner?.startsAt ?? null)} />
        </label>
        <label className={styles.field} htmlFor={`${id}-end`}>
          <span>Ends (UK time; empty = no end)</span>
          <input id={`${id}-end`} name="endsAt" type="datetime-local" defaultValue={isoToLondonInput(banner?.endsAt ?? null)} />
        </label>
      </div>

      <label className={styles.check}>
        <input type="checkbox" name="active" defaultChecked={banner?.active ?? true} />
        <span>On</span>
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          {banner ? "Save banner" : "Add banner"}
        </button>
        {banner && (
          <button type="submit" formAction={deleteBannerAction} formNoValidate className={styles.danger}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
