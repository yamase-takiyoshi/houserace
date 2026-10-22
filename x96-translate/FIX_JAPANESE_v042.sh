#!/data/data/com.termux/files/usr/bin/bash
# X96 v0.4.x: repair offline Argos + verify app server integration.
set -euo pipefail
printf '\n=== X96 英語→日本語翻訳の修復・診断 v0.4.2 ===\n'
if ! command -v proot-distro >/dev/null 2>&1; then
  echo '[ERROR] proot-distroがありません。まずv0.4のSETUP_ALL.shを実行してください。' >&2
  exit 2
fi
SERVER_DIR=''
for d in "$HOME/X96_Translator_v0.4_Ready" "$HOME/X96_Translator_v0.4.1_Repair"; do
  if [ -f "$d/server_v03.py" ]; then SERVER_DIR="$d"; break; fi
done
if [ -z "$SERVER_DIR" ]; then
  echo '[ERROR] v0.4のserver_v03.pyが見つかりません。ZIPの展開先を確認してください。' >&2
  exit 2
fi
printf '\n[1/2] Ubuntu内のArgosを点検します（不足モデルは取得）\n'
proot-distro login ubuntu -- bash -s <<'UBUNTU'
set -euo pipefail
export ARGOS_CHUNK_TYPE=MINISBD ARGOS_DEVICE_TYPE=cpu ARGOS_INTER_THREADS=1 ARGOS_INTRA_THREADS=2
P=''
for n in /root/.x96-argos/bin/python /root/x96-argos/bin/python; do
  if [ -x "$n" ]; then P="$n"; break; fi
done
if [ -z "$P" ]; then
  echo '[ERROR] /root/.x96-argos/bin/python がありません。INSTALL_ARGOS_CPU.shで環境を作成してください。' >&2
  exit 3
fi
"$P" - <<'PYTHON'
import ast, re, shutil, sysconfig
from pathlib import Path
p=Path(sysconfig.get_path('purelib'))/'argostranslate'/'sbd.py'
if not p.exists():
    raise SystemExit('[ERROR] Argosが仮想環境にインストールされていません: '+str(p))
s=p.read_text(encoding='utf-8')
if re.search(r'(?m)^import stanza[ \t]*$',s):
    fixed=re.sub(r'(?m)^import stanza[ \t]*$', 'try:\n    import stanza\nexcept ImportError:\n    stanza = None',s,count=1)
    ast.parse(fixed)
    bak=p.with_name('sbd.py.x96-original')
    if not bak.exists(): shutil.copy2(p,bak)
    p.write_text(fixed,encoding='utf-8')
    print('[OK] stanzaの必須読み込みを修復しました。')
elif re.search(r'(?m)^try:\n[ \t]+import stanza\nexcept ImportError:',s):
    print('[OK] stanzaの読み込みは修復済みです。')
else:
    raise SystemExit('[ERROR] 想定外のArgos sbd.pyです。自動修復を中止しました。')
import argostranslate.package as package
import argostranslate.translate as translate
installed={(getattr(x,'from_code',None),getattr(x,'to_code',None)) for x in package.get_installed_packages()}
print('モデル導入状況:', installed)
if ('en','ja') not in installed:
    print('英日モデルがないため公式パッケージ一覧から取得します。')
    package.update_package_index()
    matches=[m for m in package.get_available_packages() if m.from_code=='en' and m.to_code=='ja']
    if not matches: raise SystemExit('[ERROR] 英日モデルが公式インデックスで見つかりません。')
    package.install_from_path(matches[0].download())
print('英日翻訳テスト中...')
out=translate.translate('Good morning.','en','ja')
print('Good morning. =>',out)
if not re.search(r'[\u3040-\u30ff\u3400-\u9fff]',out):
    raise SystemExit('[ERROR] 日本語に翻訳できません。')
print('ARGOS_RESULT: PASS')
PYTHON
UBUNTU
printf '\n[2/2] 8767番の翻訳サーバーから呼び出せるか点検\n'
cd "$SERVER_DIR"
python - <<'PYTHON'
import re, server_v03 as s
translated,error=s.argos_translate([{'en':'Good morning.'}])
if error: print('[ERROR] サーバーからの呼び出し:',error)
if translated: print('サーバーからの結果:', translated[0])
if not translated or not re.search(r'[\u3040-\u30ff\u3400-\u9fff]',translated[0]):
    raise SystemExit('[ERROR] Argosは実行できてもサーバーとの連携に失敗しました。')
print('SERVER_RESULT: PASS')
PYTHON
printf '\n=== 修復成功！ ===\n'
printf 'すでに取り込んだ英語字幕は自動再翻訳されません。\n'
printf '8767番を一度再起動し、YouTubeのURLを再度「字幕取得・翻訳」してください。\n'
printf 'サーバー起動例: bash %s/START.sh\n' "$SERVER_DIR"
