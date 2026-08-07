import sharp from "sharp";
import { join } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const srcLogo = join(assets, "LOGO.jpg");

// ── Expo asset icons ─────────────────────────────────────
await sharp(srcLogo)
  .resize(920, 920, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .extend({ top: 52, bottom: 52, left: 52, right: 52, background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toFile(join(assets, "app-icon.png"));

await sharp(srcLogo)
  .resize(680, 680, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .extend({ top: 172, bottom: 172, left: 172, right: 172, background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png()
  .toFile(join(assets, "adaptive-icon.png"));

await sharp(srcLogo)
  .resize(800, 800, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .extend({ top: 112, bottom: 112, left: 112, right: 112, background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toFile(join(assets, "splash-icon.png"));

const n = 96;
const { data, info } = await sharp(srcLogo)
  .resize(n, n, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const a = data[i + 3];
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  if (a > 20 && lum < 250) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  } else {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 0;
  }
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(join(assets, "notification-icon.png"));

// ── Android mipmaps ──────────────────────────────────────
const res = join(root, "android/app/src/main/res");
const appIcon = join(assets, "app-icon.png");
const adaptive = join(assets, "adaptive-icon.png");
const sizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

for (const [folder, size] of Object.entries(sizes)) {
  const dir = join(res, folder);
  mkdirSync(dir, { recursive: true });
  await sharp(appIcon).resize(size, size).png().toFile(join(dir, "ic_launcher.png"));
  await sharp(appIcon).resize(size, size).png().toFile(join(dir, "ic_launcher_round.png"));
  await sharp(adaptive).resize(size, size).png().toFile(join(dir, "ic_launcher_foreground.png"));
  console.log(folder, size);
}

const anydpi = join(res, "mipmap-anydpi-v26");
mkdirSync(anydpi, { recursive: true });
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
writeFileSync(join(anydpi, "ic_launcher.xml"), adaptiveXml);
writeFileSync(join(anydpi, "ic_launcher_round.xml"), adaptiveXml);

const values = join(res, "values");
mkdirSync(values, { recursive: true });
const colorsPath = join(values, "colors.xml");
let colors = existsSync(colorsPath)
  ? readFileSync(colorsPath, "utf8")
  : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
if (!colors.includes("iconBackground")) {
  colors = colors.replace("</resources>", '  <color name="iconBackground">#FFFFFF</color>\n</resources>');
} else {
  colors = colors.replace(
    /<color name="iconBackground">[^<]*<\/color>/,
    '<color name="iconBackground">#FFFFFF</color>',
  );
}
writeFileSync(colorsPath, colors);

const drawable = join(res, "drawable");
mkdirSync(drawable, { recursive: true });
await sharp(join(assets, "splash-icon.png"))
  .resize(288, 288, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .png()
  .toFile(join(drawable, "splashscreen_logo.png"));

console.log("CPF icons written to assets + android mipmaps");
