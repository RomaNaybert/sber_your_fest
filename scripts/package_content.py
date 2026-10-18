#!/usr/bin/env python3
"""Validate an exported Content Studio JSON and package game/ with it. Never deploys."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import zipfile

BASE = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description='Проверить файл из Студии и собрать игровой ZIP без админки.')
    parser.add_argument('content', type=Path, help='Скачанный scenarios.json')
    parser.add_argument('--output', type=Path, default=BASE / 'output/festival-content-package.zip')
    args = parser.parse_args()
    data = json.loads(args.content.read_text(encoding='utf-8'))
    program = '''import fs from 'node:fs';
import {validateContent} from ''' + json.dumps((BASE/'content-studio/validation.js').as_uri()) + ''';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const assets=JSON.parse(fs.readFileSync(''' + json.dumps(str(BASE/'content-studio/assets.json')) + ''','utf8'));
const baseline=JSON.parse(fs.readFileSync(''' + json.dumps(str(BASE/'game/content/scenarios.json')) + ''','utf8'));
const result=validateContent(data,{assets,baseline});
if(!result.valid){console.error(result.errors.map(e=>e.where+': '+e.message).join('\\n'));process.exit(1);}
console.log(result.proof.length);
'''
    check = subprocess.run(['node', '--input-type=module', '-e', program], input=json.dumps(data, ensure_ascii=False), text=True, capture_output=True)
    if check.returncode:
        raise ValueError(check.stderr.strip() or 'Проверка игровым движком не пройдена.')
    files = {}
    for path in (BASE/'game').rglob('*'):
        if path.is_symlink():
            raise ValueError(f'Символьные ссылки не включаются: {path}')
        if path.is_file() and path.name != '.DS_Store':
            files[path.relative_to(BASE/'game').as_posix()] = path.read_bytes()
    files['content/scenarios.json'] = (json.dumps(data, ensure_ascii=False, indent=2)+'\n').encode()
    total = sum(map(len, files.values()))
    if total > 5_000_000:
        raise ValueError(f'Пакет превышает 5 МБ: {total} байт.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, payload in sorted(files.items()):
            archive.writestr(name, payload)
    print(f'Проверено площадок: {check.stdout.strip()}. Файлов игры: {len(files)}. Размер до сжатия: {total} байт.')
    print(f'Создан {args.output.resolve()}. Студия не включена. Публикация не выполнялась.')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f'Не удалось собрать пакет: {error}', file=sys.stderr)
        sys.exit(1)
