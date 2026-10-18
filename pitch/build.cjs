// Builds the Colosseum pitch video: HTML title cards (rendered in headless
// Edge) + clips from the screen recordings, one scene at a time, then
// concatenated. Silent (with an empty audio track) — the team records the
// voiceover on top using SCRIPT.md.  Usage: npm run build  (in pitch/)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");
const FFMPEG = require("ffmpeg-static");

const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const OUT = path.join(ROOT, "out");
const CARDS = path.join(OUT, "cards");
const SCENES = path.join(OUT, "scenes");
fs.mkdirSync(CARDS, { recursive: true });
fs.mkdirSync(SCENES, { recursive: true });

const W = 1920;
const H = 1080;
const FPS = 30;
const FADE = 0.35;
// Voiced scenes: the line starts LEAD s after the cut and the picture holds TAIL s after it.
const LEAD = 0.6;
const TAIL = 0.9;
// Right-hand area where footage sits (the left ~40% holds the caption).
const AREA = { x: 860, y: 110, w: 980, h: 860 };
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));

const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/");
const asset = (rel) => fileUrl(path.join(ROOT, rel));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ff = (args) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

/** Width × height of a video, read from ffmpeg's stream info. */
function videoSize(file) {
  let info = "";
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-i", file], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    info = String(e.stderr);
  }
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
  if (!m) throw new Error(`Can't read video size of ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** Largest rect with the source aspect that fits AREA, centred, even-sized for H.264. */
function fitRect(src) {
  const s = Math.min(AREA.w / src.w, AREA.h / src.h);
  const w = Math.round((src.w * s) / 2) * 2;
  const h = Math.round((src.h * s) / 2) * 2;
  return { x: Math.round(AREA.x + (AREA.w - w) / 2), y: Math.round(AREA.y + (AREA.h - h) / 2), w, h };
}

// ------------------------------------------------------------------ HTML --
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:"Segoe UI",system-ui,sans-serif;color:#e5e7eb;
  background:radial-gradient(ellipse 70% 60% at 15% 0%,rgba(139,92,246,.35),transparent 60%),
             radial-gradient(ellipse 60% 50% at 100% 100%,rgba(20,241,149,.12),transparent 60%),#0a0a14}
.brand{position:absolute;left:80px;top:46px;font-size:26px;font-weight:700;display:flex;gap:10px;align-items:center}
.brand b{background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;color:transparent}
.tag{position:absolute;right:80px;top:50px;font-size:18px;color:#9ca3af;letter-spacing:.08em}
.kicker{font-size:22px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#14f195;margin-bottom:22px}
h1{font-size:62px;line-height:1.08;font-weight:800;color:#fff;letter-spacing:-.01em}
h1 .g{background:linear-gradient(90deg,#c4b5fd,#22d3ee);-webkit-background-clip:text;color:transparent}
ul{list-style:none;margin-top:38px;display:flex;flex-direction:column;gap:20px}
li{font-size:29px;line-height:1.3;color:#cbd5e1;padding-left:42px;position:relative}
li:before{content:"";position:absolute;left:0;top:13px;width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#9945ff,#14f195)}
.left{position:absolute;left:80px;top:0;bottom:0;width:720px;display:flex;flex-direction:column;justify-content:center}
.frame{position:absolute;border-radius:26px;background:rgba(255,255,255,.04);border:1px solid rgba(148,121,255,.35);
  box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.03),0 0 60px rgba(139,92,246,.25)}
.chip{display:inline-flex;align-items:center;gap:12px;padding:16px 24px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(148,121,255,.3);font-size:26px;font-weight:600;color:#fff}
.pet{border-radius:22px;background:rgba(255,255,255,.04)}
`;

const page = (body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>
<div class="brand">🐾 <b>PetNFT</b></div><div class="tag">COLOSSEUM · SOLANA</div>${body}</body>`;

const titleHtml = (t) => esc(t).replace(/(one-of-a-kind|never existed before|truly yours|real SOL|Solana|stronger|real artist|every trade|today|one pet)/, '<span class="g">$1</span>');
const caption = (sc) =>
  `<div class="left"><div class="kicker">${esc(sc.kicker)}</div><h1>${titleHtml(sc.title)}</h1>${
    sc.bullets && sc.bullets.length ? `<ul>${sc.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""
  }</div>`;

function html(sc, rect) {
  const pad = 14;
  const frame = rect ? `<div class="frame" style="left:${rect.x - pad}px;top:${rect.y - pad}px;width:${rect.w + pad * 2}px;height:${rect.h + pad * 2}px"></div>` : "";
  switch (sc.layout) {
    case "footage":
      return page(caption(sc) + frame);
    case "image": {
      const [, , cw, ch] = sc.image.crop;
      return page(
        caption(sc) +
          frame +
          `<div style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;border-radius:14px;overflow:hidden">
             <img src="${asset(sc.image.file)}" style="width:${(rect.w / cw) * 1100}px;margin-top:${-(sc.image.crop[1] * rect.w) / cw}px;display:block">
           </div>`
      );
    }
    case "problem": {
      const clones = Array.from({ length: 18 }, () => `<img class="pet" src="${asset("assets/pets/clone.svg")}" style="width:150px;height:150px;filter:grayscale(1) brightness(.75)">`).join("");
      return page(
        caption(sc) +
          `<div style="position:absolute;left:900px;top:190px;display:grid;grid-template-columns:repeat(6,150px);gap:18px;opacity:.9">${clones}</div>
           <div style="position:absolute;left:1240px;top:760px;font-size:84px;font-weight:900;color:#f87171;transform:rotate(-6deg);text-shadow:0 8px 30px rgba(0,0,0,.6)">× 10,000</div>`
      );
    }
    case "solana": {
      const chips = ["👛 Phantom · SIWS", "⚡ Sub-second payments", "🖼 Metaplex NFTs", "🪙 Token-2022 PETCOIN", "⚓ Anchor programs", "🧾 On-chain verification"];
      return page(
        caption(sc) +
          `<div style="position:absolute;left:1000px;top:190px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(153,69,255,.35),rgba(20,241,149,.08) 60%,transparent 70%)"></div>
           <div style="position:absolute;left:1010px;top:250px;width:740px;display:flex;flex-wrap:wrap;gap:22px;justify-content:center">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>
           <div style="position:absolute;left:1010px;top:690px;width:740px;text-align:center;font-size:150px;font-weight:900;background:linear-gradient(90deg,#9945ff,#14f195);-webkit-background-clip:text;color:transparent">◎ SOL</div>`
      );
    }
    case "cards":
      return page(
        `<div style="position:absolute;left:80px;right:80px;top:190px"><div class="kicker">${esc(sc.kicker)}</div><h1 style="max-width:1400px">${titleHtml(sc.title)}</h1></div>
         <div style="position:absolute;left:80px;right:80px;top:520px;display:grid;grid-template-columns:repeat(4,1fr);gap:28px">${sc.cards
           .map(
             (c) => `<div style="border-radius:26px;padding:36px;background:rgba(255,255,255,.045);border:1px solid rgba(148,121,255,.3);min-height:330px">
               <div style="font-size:70px">${c.icon}</div><div style="font-size:34px;font-weight:800;color:#fff;margin-top:18px">${esc(c.title)}</div>
               <div style="font-size:25px;color:#9ca3af;margin-top:12px;line-height:1.35">${esc(c.text)}</div></div>`
           )
           .join("")}</div>`
      );
    case "roadmap":
      return page(
        `<div style="position:absolute;left:80px;top:190px;width:900px"><div class="kicker">${esc(sc.kicker)}</div><h1>${titleHtml(sc.title)}</h1>
           <div style="display:flex;flex-direction:column;gap:20px;margin-top:50px">${sc.status.map((s) => `<span class="chip" style="align-self:flex-start">✅ ${esc(s)}</span>`).join("")}</div>
           <div style="margin-top:44px;font-size:30px;color:#22d3ee;font-weight:700">${esc(cfg.links.app)}</div></div>
         <div style="position:absolute;left:1080px;top:260px;width:760px;display:flex;flex-direction:column;gap:30px">${sc.roadmap
           .map(
             (r, i) => `<div style="display:flex;gap:26px;align-items:flex-start">
               <div style="flex:none;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#9945ff,#14f195);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#0a0a14">${i + 1}</div>
               <div><div style="font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:#a78bfa;font-weight:700">${esc(r.when)}</div>
               <div style="font-size:33px;color:#fff;font-weight:700;margin-top:6px;line-height:1.25">${esc(r.what)}</div></div></div>`
           )
           .join("")}</div>`
      );
    case "team": {
      // Avatars: Legendary pets in the app's gold rarity frame + badge. Compact row for 4+ people.
      const n = cfg.team.length;
      const big = n <= 3;
      const card = big ? 460 : 330;
      const img = big ? 290 : 220;
      return page(
        `<div style="position:absolute;left:80px;right:80px;top:${big ? 170 : 150}px;text-align:center"><div class="kicker">${esc(sc.kicker)}</div><h1>${titleHtml(sc.title)}</h1></div>
         <div style="position:absolute;left:0;right:0;top:${big ? 400 : 380}px;display:flex;justify-content:center;gap:${big ? 120 : 18}px">${cfg.team
           .map(
             (m, i) => `<div style="text-align:center;width:${card}px;display:flex;flex-direction:column;align-items:center">
               <div style="padding:5px;border-radius:30px;background:linear-gradient(110deg,#b45309,#fde68a,#f59e0b,#fff7d6,#d97706,#fde68a);box-shadow:0 0 44px -6px #f59e0b">
                 <div style="border-radius:26px;overflow:hidden;background:radial-gradient(circle at 50% 35%,rgba(245,158,11,.28),#15142a 75%)">
                   <img src="${asset(m.avatar || `assets/pets/unique-${(i * 5 + 2) % 12}.svg`)}" style="width:${img}px;height:${img}px;display:block"></div></div>
               <div style="margin-top:-18px;padding:6px 14px;border-radius:999px;font-size:${big ? 20 : 16}px;font-weight:800;letter-spacing:.06em;color:#3b2300;background:linear-gradient(110deg,#f59e0b,#fde68a,#f59e0b);border:1px solid #fde68a;box-shadow:0 0 16px -2px #f59e0b">LEGENDARY ★★★★★</div>
               <div style="font-size:${big ? 40 : 30}px;font-weight:800;color:#fff;margin-top:20px;line-height:1.15">${esc(m.name)}</div>
               <div style="font-size:${big ? 26 : 22}px;color:#9ca3af;margin-top:8px">${esc(m.role)}</div></div>`
           )
           .join("")}</div>`
      );
    }
    case "cta": {
      const pets = Array.from({ length: 12 }, (_, i) => `<img class="pet" src="${asset(`assets/pets/unique-${i}.svg`)}" style="width:170px;height:170px">`);
      return page(
        `<div style="position:absolute;left:0;right:0;top:120px;display:flex;justify-content:center;gap:22px">${pets.slice(0, 6).join("")}</div>
         <div style="position:absolute;left:0;right:0;top:380px;text-align:center">
           <h1 style="font-size:104px"><span class="g">${esc(sc.title)}</span></h1>
           <div style="font-size:36px;color:#fff;margin-top:26px;font-weight:700">${esc(cfg.links.app)}</div>
           <div style="font-size:28px;color:#9ca3af;margin-top:10px">${esc(cfg.links.github)}</div></div>
         <div style="position:absolute;left:0;right:0;bottom:120px;display:flex;justify-content:center;gap:22px">${pets.slice(6).join("")}</div>
         <div style="position:absolute;left:0;right:0;bottom:44px;text-align:center;font-size:22px;color:#9ca3af;letter-spacing:.02em">${(cfg.contacts || [])
           .map((c) => `${esc(c.label)}: <span style="color:#e5e7eb">${esc(c.email)}</span>`)
           .join(`<span style="margin:0 22px;color:#4b5563">·</span>`)}</div>`
      );
    }
    default:
      throw new Error(`Unknown layout ${sc.layout}`);
  }
}

// ------------------------------------------------------------- build ----
(async () => {
  if (!EDGE) throw new Error("Microsoft Edge not found — set the browser path in build.cjs");
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--allow-file-access-from-files"] });
  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H });

  const parts = [];
  let t0 = 0;
  const timeline = [];
  for (const sc of cfg.scenes) {
    const clipFile = sc.clip ? path.join(cfg.videos, sc.clip.file) : null;
    const crop = sc.clip && sc.clip.crop; // [w, h, x, y] in source pixels
    const rect = clipFile ? fitRect(crop ? { w: crop[0], h: crop[1] } : videoSize(clipFile)) : sc.layout === "image" ? fitRect({ w: sc.image.crop[2], h: sc.image.crop[3] }) : null;
    const voice = sc.voice && { ...sc.voice, path: path.join(cfg.voiceDir, sc.voice.file), len: sc.voice.to - sc.voice.from };
    const dur = Number((voice ? LEAD + voice.len + TAIL : sc.clip ? sc.clip.t : sc.dur).toFixed(2));

    const cardHtml = path.join(CARDS, `${sc.id}.html`);
    const cardPng = path.join(CARDS, `${sc.id}.png`);
    fs.writeFileSync(cardHtml, html(sc, rect));
    await tab.goto(fileUrl(cardHtml), { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 150));
    await tab.screenshot({ path: cardPng });

    const out = path.join(SCENES, `${sc.id}.mp4`);
    const fades = `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(dur - FADE).toFixed(2)}:d=${FADE},format=yuv420p`;
    // Audio input: the scene's voice line, or silence. Either way it ends up stereo 48 kHz, exactly `dur` long.
    const audio = voice
      ? ["-ss", String(voice.from), "-t", voice.len.toFixed(3), "-i", voice.path]
      : ["-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
    const audioIdx = clipFile ? 2 : 1;
    const ms = Math.round(LEAD * 1000);
    const aChain = voice
      ? `[${audioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},apad,atrim=0:${dur},afade=t=in:d=0.05,afade=t=out:st=${(dur - 0.15).toFixed(2)}:d=0.15[a]`
      : `[${audioIdx}:a]anull[a]`;
    const enc = ["-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "128k", "-t", String(dur), out];
    if (clipFile) {
      ff([
        "-loop", "1", "-t", String(dur), "-i", cardPng,
        "-ss", String(sc.clip.ss), "-t", String(dur), "-i", clipFile,
        ...audio,
        "-filter_complex",
        `[1:v]fps=${FPS},${crop ? `crop=${crop.join(":")},` : ""}scale=${rect.w}:${rect.h}:flags=lanczos,setsar=1[c];[0:v][c]overlay=${rect.x}:${rect.y}:eof_action=repeat,${fades}[v];${aChain}`,
        "-map", "[v]", "-map", "[a]", ...enc,
      ]);
    } else {
      // Title cards: a very slow push-in so the frame isn't frozen.
      const frames = Math.round(dur * FPS);
      ff([
        "-loop", "1", "-t", String(dur), "-i", cardPng, ...audio,
        "-filter_complex",
        `[0:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},${fades}[v];${aChain}`,
        "-map", "[v]", "-map", "[a]", ...enc,
      ]);
    }
    parts.push(out);
    timeline.push({ id: sc.id, start: t0, dur });
    t0 += dur;
    console.log(`✓ ${sc.id.padEnd(16)} ${dur}s${voice ? " 🎙" : ""}`);
  }
  await browser.close();

  const list = path.join(OUT, "concat.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
  const final = path.join(ROOT, cfg.output);
  const joined = path.join(OUT, "joined.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
  // One loudness pass over the whole voice track (the takes were recorded separately).
  ff(["-i", joined, "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final]);
  fs.unlinkSync(joined);
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 2));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  console.log(`\n${final}\nTotal ${mmss(t0)} (Colosseum limit: 3:00)`);
  for (const s of timeline) console.log(`  ${mmss(s.start)}  ${s.id}`);
})();
