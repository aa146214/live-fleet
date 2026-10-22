import { bannerColour } from "@/lib/banners";
import styles from "../admin.module.css";

/** A banner as it looks on the map, for the admin's list. */
export function BannerStrip({ banner }: { banner: { message: string; colour: string } }) {
  const colour = bannerColour(banner.colour);
  return (
    <span className={styles.bannerPreview} style={{ background: colour.background, color: colour.text }}>
      {banner.message}
    </span>
  );
}
