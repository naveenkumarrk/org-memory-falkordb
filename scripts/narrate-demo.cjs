// Optional Windows/WSL speech synthesis, performed locally without an external API.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const scenes = JSON.parse(fs.readFileSync('scripts/demo-scenes.json', 'utf8'));
const root = path.resolve('.demo/narration'); fs.mkdirSync(root, { recursive: true });
const tag = `orgmem-demo-${randomUUID()}`;
const literal = s => `'${s.replaceAll("'", "''")}'`;
const code = [
  'Add-Type -AssemblyName System.Speech',
  '$narrator = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  "$narrator.SelectVoice('Microsoft Zira Desktop')", '$narrator.Rate = 1',
  ...scenes.flatMap(s => [
    `$target = Join-Path ([IO.Path]::GetTempPath()) ${literal(`${tag}-${s.id}.wav`)}`,
    '$narrator.SetOutputToWaveFile($target)', `$narrator.Speak(${literal(s.speech)})`,
    '$narrator.SetOutputToNull()', `Write-Output (${literal(`${s.id}|`)} + $target)`,
  ]), '$narrator.Dispose()',
].join('\n');
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
if (result.error || result.status !== 0) throw new Error(`Local speech synthesis failed: ${result.stderr}`);
for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
  const [id, winpath] = line.split('|');
  const source = execFileSync('wslpath', ['-u', winpath], { encoding: 'utf8' }).trim();
  const bytes = fs.readFileSync(source); fs.copyFileSync(source, path.join(root, `${id}.wav`)); fs.unlinkSync(source);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid speech waveform');
  let position = 12, rate = 0, length = 0;
  while (position + 8 <= bytes.length) {
    const name = bytes.toString('ascii', position, position + 4), size = bytes.readUInt32LE(position + 4);
    if (name === 'fmt ') rate = bytes.readUInt32LE(position + 16);
    if (name === 'data') length = size;
    position += 8 + size + size % 2;
  }
  const scene = scenes.find(s => s.id === id); scene.audio = path.join(root, `${id}.wav`); scene.duration_ms = Math.ceil(length / rate * 1000);
}
if (scenes.some(s => !s.audio || !Number.isFinite(s.duration_ms))) throw new Error('Incomplete narration');
fs.writeFileSync(path.join(root, 'scenes.json'), JSON.stringify(scenes, null, 2));
console.log(`Generated ${scenes.length} local speech clips (${Math.round(scenes.reduce((n,s)=>n+s.duration_ms,0)/1000)} seconds of narration).`);
