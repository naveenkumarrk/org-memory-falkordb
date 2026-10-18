"""Optional FFmpeg render: actual recording + time-aligned locally synthesized narration."""
import json
import os
import subprocess
import sys
from pathlib import Path

subprocess.run([sys.executable, 'scripts/align-demo.py'], check=True)
manifest = json.loads(Path('.demo/full-demo-manifest.json').read_text())
scenes = manifest['scenes']
binary = os.environ.get('ORG_MEMORY_FFMPEG', '.demo/media-tools/ffmpeg')
output = '.demo/org-memory-full-demo.mp4'
args = [binary, '-hide_banner', '-loglevel', 'warning', '-y', '-i', manifest['video']]
for scene in scenes:
    args += ['-i', scene['audio']]
filters = [f"[{i + 1}:a]adelay={scene['start_ms']}:all=1[a{i}]" for i, scene in enumerate(scenes)]
filters += [''.join(f'[a{i}]' for i in range(len(scenes))) + f'amix=inputs={len(scenes)}:duration=longest:normalize=0,apad[narration]']
args += ['-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[narration]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', output]
subprocess.run(args, check=True)

def timestamp(ms):
    seconds, ms = divmod(int(ms), 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f'{hours:02}:{minutes:02}:{seconds:02},{ms:03}'

captions = []
for index, scene in enumerate(scenes, 1):
    captions.append(f"{index}\n{timestamp(scene['start_ms'])} --> {timestamp(scene['start_ms'] + scene['duration_ms'])}\n{scene['speech']}\n")
Path('.demo/org-memory-full-demo.srt').write_text('\n'.join(captions))
transcript = '# Demo video transcript\n\nGenerated narration over a recording of the live local application and actual CLI output. Synthetic scenario and local client profiles; no live LLM task is claimed.\n\n'
transcript += '\n\n'.join(f"## {s['title']}\n\n{s['speech']}" for s in scenes)
Path('.demo/org-memory-demo-transcript.md').write_text(transcript + '\n')
print(f'Rendered {output}, subtitles, and transcript.')
