import {execFileSync} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

const input = resolve(process.argv[2] ?? 'out/hermes-business-promo.mp4');
if (!existsSync(input)) throw new Error(`Missing video: ${input}`);

const output = execFileSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate',
  '-of', 'json',
  input,
], {encoding: 'utf8'});
const probe = JSON.parse(output);
const video = probe.streams.find((stream) => stream.width);
const audio = probe.streams.find((stream) => stream.codec_name === 'aac');
const duration = Number(probe.format.duration);

if (video?.width !== 1920 || video?.height !== 1080) throw new Error('Expected 1920x1080');
if (Math.abs(duration - 55) > 0.2) throw new Error(`Expected ~55s, got ${duration}s`);
if (!audio) throw new Error('Expected AAC soundtrack');
if (statSync(input).size < 1_000_000) throw new Error('Rendered file is unexpectedly small');

console.log(JSON.stringify({
  path: input,
  durationSeconds: duration,
  resolution: `${video.width}x${video.height}`,
  fps: video.r_frame_rate,
  videoCodec: video.codec_name,
  audioCodec: audio.codec_name,
  bytes: statSync(input).size,
}, null, 2));
