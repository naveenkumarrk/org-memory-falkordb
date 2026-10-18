"""Align narration to visible caption changes in the actual 1600x900 recording."""
import json
import os
import subprocess
from pathlib import Path

manifest_path = Path('.demo/full-demo-manifest.json')
manifest = json.loads(manifest_path.read_text())
binary = os.environ.get('ORG_MEMORY_FFMPEG', '.demo/media-tools/ffmpeg')
# The fixed title band excludes the variable page behind the dark caption panel.
# Detect scene changes from actual video frames rather than relying on automation timing.
fps, width, height = 5, 1450, 32
command = [binary, '-loglevel', 'error', '-i', manifest['video'], '-vf', f'fps={fps},crop={width}:{height}:50:798,format=gray', '-f', 'rawvideo', 'pipe:1']
process = subprocess.Popen(command, stdout=subprocess.PIPE)
table = bytes(1 if value > 150 else 0 for value in range(256))
previous, index, last = None, 0, -100
starts = []
while True:
    frame = process.stdout.read(width * height)
    if not frame:
        break
    if len(frame) != width * height:
        raise RuntimeError('Incomplete video frame')
    pixels = frame.translate(table)
    if previous is not None:
        changed = sum(a != b for a, b in zip(pixels, previous))
        if changed > 700 and index - last > 3:
            starts.append(round(index / fps * 1000))
            last = index
    previous, index = pixels, index + 1
if process.wait() != 0:
    raise RuntimeError('Video decoding failed')
scenes = manifest['scenes']
if len(starts) != len(scenes):
    raise RuntimeError(f'Found {len(starts)} caption transitions for {len(scenes)} scenes; inspect the recording before rendering.')
for scene, at in zip(scenes, starts):
    scene.setdefault('workflow_start_ms', scene['start_ms'])
    scene['start_ms'] = at
for before, after in zip(scenes, scenes[1:]):
    if before['start_ms'] + before['duration_ms'] > after['start_ms']:
        raise RuntimeError('Narration would overlap the next visible scene')
manifest['timing_alignment'] = {'method': 'visible_caption_title_changes', 'sample_fps': fps, 'detected_scenes': len(starts)}
manifest_path.write_text(json.dumps(manifest, indent=2))
print(f'Aligned all {len(scenes)} narration clips to visible scene changes in the actual video.')
