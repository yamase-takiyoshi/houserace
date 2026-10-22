#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if ! command -v proot-distro >/dev/null 2>&1; then
  echo 'ERROR: proot-distro が見つかりません。まずv0.4の初期セットアップが必要です。'
  exit 1
fi
echo '[1/3] UbuntuのArgos v1.11.0を修復します'
proot-distro login ubuntu -- bash -s <<'UBUNTU'
set -euo pipefail
export ARGOS_DEVICE_TYPE=cpu ARGOS_CHUNK_TYPE=MINISBD ARGOS_INTER_THREADS=1 ARGOS_INTRA_THREADS=2
PYEXE=""
for candidate in /root/.x96-argos/bin/python /root/x96-argos/bin/python; do
  if [ -x "$candidate" ]; then PYEXE="$candidate"; break; fi
done
if [ -z "$PYEXE" ]; then
  echo 'Argos仮想環境がありません。v0.4の初期セットアップが必要です。'
  exit 2
fi
"$PYEXE" - <<'PYFIX'
import re, shutil, sysconfig, ast
from pathlib import Path
p=Path(sysconfig.get_path('purelib'))/'argostranslate'/'sbd.py'
if not p.is_file(): raise SystemExit(f'sbd.py が見つかりません: {p}')
s=p.read_text(encoding='utf-8')
if re.search(r'(?m)^try:\n\s+import stanza\nexcept ImportError:',s):
    print('stanza import は既に修復済みです')
elif re.search(r'(?m)^import stanza[ \t]*$',s):
    bak=p.with_name('sbd.py.x96-original')
    if not bak.exists(): shutil.copy2(p,bak)
    new=re.sub(r'(?m)^import stanza[ \t]*$', 'try:\n    import stanza\nexcept ImportError:\n    stanza = None', s, count=1)
    ast.parse(new)
    p.write_text(new,encoding='utf-8')
    print('Argos v1.11.0の読み込みを修正しました:',p)
else:
    raise SystemExit('想定外のArgos版です。自動修正を中止しました')
PYFIX
echo '[2/3] 英日モデルを確認・テストします'
"$PYEXE" - <<'PYTEST'
import os
os.environ['ARGOS_DEVICE_TYPE']='cpu'
os.environ['ARGOS_CHUNK_TYPE']='MINISBD'
import argostranslate.package as pkg
import argostranslate.translate as tr
installed={(p.from_code,p.to_code) for p in pkg.get_installed_packages() if p.type=='translate'}
if ('en','ja') not in installed:
    print('英日モデルが未導入のため、公式モデルをダウンロードします')
    pkg.update_package_index()
    matches=[p for p in pkg.get_available_packages() if p.from_code=='en' and p.to_code=='ja' and p.type=='translate']
    if not matches: raise RuntimeError('英日モデルが取得できません')
    pkg.install_from_path(matches[0].download())
    tr.get_installed_languages.cache_clear()
out=tr.translate('Good morning.','en','ja')
print('Good morning. →',out)
if not out or out.strip()=='Good morning.': raise RuntimeError('英日翻訳ができません')
print('RESULT: PASS')
PYTEST
UBUNTU
echo '[3/3] 既存v0.4の動作確認'
if [ -f "$HOME/X96_Translator_v0.4_Ready/CHECK.sh" ]; then
  bash "$HOME/X96_Translator_v0.4_Ready/CHECK.sh"
fi
echo '修復テスト完了。8767番のサーバーを再起動してください'
