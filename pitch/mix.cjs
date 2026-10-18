// Puts the recorded voiceover on the pitch video.
//   npm run mix -- "C:/path/to/voice.m4a"   ->  out/petnft-pitch-final.mp4
// The voice is loudness-normalised (YouTube-ish -16 LUFS) and padded with silence, so the
// video always plays to the end even if the voice is shorter; the video stream is copied untouched.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");

const voice = process.argv[2];
if (!voice || !fs.existsSync(voice)) {
  console.error('Usage: npm run mix -- "path/to/voice.m4a"');
  process.exit(1);
}
const video = path.join(__dirname, "out", "petnft-pitch.mp4");
const out = path.join(__dirname, "out", "petnft-pitch-final.mp4");
execFileSync(
  FFMPEG,
  ["-v", "error", "-y", "-i", video, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out],
  { stdio: "inherit" }
);
console.log("✓", out);
