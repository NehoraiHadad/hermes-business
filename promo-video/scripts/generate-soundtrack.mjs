import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sampleRate = 48000;
const seconds = 55;
const samples = sampleRate * seconds;
const channels = 2;
const data = Buffer.alloc(samples * channels * 2);
const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '..', 'public', 'soundtrack.wav');

const chords = [
  [130.81, 164.81, 196.0],
  [110.0, 130.81, 164.81],
  [87.31, 110.0, 130.81],
  [98.0, 123.47, 146.83],
];
const sceneStarts = [0, 5.5, 12, 19.5, 25.5, 32, 38, 45, 50];

const ease = (x) => x * x * (3 - 2 * x);
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const envelope = (time) => ease(clamp(time / 2.6, 0, 1)) * ease(clamp((seconds - time) / 3.8, 0, 1));

for (let i = 0; i < samples; i++) {
  const time = i / sampleRate;
  const chordIndex = Math.floor(time / 6.875) % chords.length;
  const local = (time % 6.875) / 6.875;
  const chord = chords[chordIndex];
  let wave = 0;

  chord.forEach((frequency, index) => {
    const breathe = 0.72 + Math.sin(time * 0.34 + index) * 0.08;
    wave += Math.sin(Math.PI * 2 * frequency * time + index * 0.7) * 0.12 * breathe;
    wave += Math.sin(Math.PI * 2 * frequency * 2 * time) * 0.018;
  });
  wave += Math.sin(Math.PI * 2 * chord[0] * 0.5 * time) * 0.1;
  wave *= 0.82 + Math.sin(local * Math.PI) * 0.18;

  for (const start of sceneStarts) {
    const bellTime = time - start;
    if (bellTime >= 0 && bellTime < 1.8) {
      const bell = Math.exp(-bellTime * 3.3);
      wave += Math.sin(Math.PI * 2 * 784 * bellTime) * bell * 0.035;
      wave += Math.sin(Math.PI * 2 * 1174.66 * bellTime) * bell * 0.018;
    }
  }

  const pan = Math.sin(time * 0.11) * 0.08;
  const amplitude = clamp(wave * envelope(time) * 0.55, -0.98, 0.98);
  data.writeInt16LE(Math.round(amplitude * (1 - pan) * 32767), i * 4);
  data.writeInt16LE(Math.round(amplitude * (1 + pan) * 32767), i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28);
header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, Buffer.concat([header, data]));
console.log(`Created ${output}`);
