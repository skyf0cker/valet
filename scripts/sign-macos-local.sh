#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

# When VALET_SIGNING_IDENTITY is set, `mygo build` already signed the bundle & DMG
# with the Apple-issued identity (Hardened Runtime + Apple Timestamp).
if [[ -n "${VALET_SIGNING_IDENTITY:-}" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IDENTITY="${VALET_LOCAL_SIGNING_IDENTITY:-Valet Local Dev}"
ENTITLEMENTS_BUN="$ROOT_DIR/resources/sidecar.entitlements.plist"

find_identity_sha1() {
  security find-identity -v -p codesigning 2>/dev/null | awk -v id="\"${1}\"" '
    {
      pos = length($0) - length(id) + 1
      if (pos > 0 && substr($0, pos) == id) {
        print $2
        exit
      }
    }
  '
}

SHA1="$(find_identity_sha1 "$IDENTITY" || true)"
if [[ -z "$SHA1" ]]; then
  echo "[valet] 未找到本机签名身份 \"$IDENTITY\"，保留 ad-hoc 签名。如需在版本更新后持久保留 macOS 权限，请运行：bun run signing:setup"
  exit 0
fi

hdiutil_retry() {
  local attempt=0
  local delay=2
  local out=""
  while true; do
    if out="$(hdiutil "$@" 2>&1)"; then
      printf '%s\n' "$out"
      return 0
    fi
    if [[ "$out" != *"Resource busy"* ]] || (( attempt >= 4 )); then
      printf '%s\n' "$out" >&2
      return 1
    fi
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

convert_dmg() {
  local rw="$1"
  local out_dmg="$2"
  if diskutil image create from -h >/dev/null 2>&1; then
    rm -f "$out_dmg"
    diskutil image create from --format ULMO "$rw" "$out_dmg"
  else
    hdiutil convert "$rw" -format ULMO -ov -o "$out_dmg"
  fi
}

ACTIVE_DMG_WORK=""
ACTIVE_DMG_DISK=""

cleanup_active_dmg() {
  if [[ -n "${ACTIVE_DMG_DISK:-}" ]]; then
    hdiutil detach -force "$ACTIVE_DMG_DISK" >/dev/null 2>&1 || true
    ACTIVE_DMG_DISK=""
  fi
  if [[ -n "${ACTIVE_DMG_WORK:-}" ]]; then
    rm -rf "$ACTIVE_DMG_WORK"
    ACTIVE_DMG_WORK=""
  fi
}
trap cleanup_active_dmg EXIT

rebuild_dmg_for_app() {
  local app_path="$1"
  local dmg_path="$2"
  local arch_dir
  arch_dir="$(dirname "$app_path")"
  local app_name
  app_name="$(basename "$app_path")"
  local vol_name="${app_name%.app}"

  ACTIVE_DMG_WORK="$(mktemp -d "$arch_dir/.dmg-local-XXXXXX")"
  ACTIVE_DMG_DISK=""
  local dmg_work="$ACTIVE_DMG_WORK"

  local src_dir="$dmg_work/src"
  mkdir -p "$src_dir"
  ditto --noclone "$app_path" "$src_dir/$app_name"
  ln -s /Applications "$src_dir/Applications"

  local icon_file=""
  if [[ -f "$app_path/Contents/Resources/icon.icns" ]]; then
    icon_file="$app_path/Contents/Resources/icon.icns"
  else
    shopt -s nullglob
    local icons=("$app_path/Contents/Resources/"*.icns)
    shopt -u nullglob
    if (( ${#icons[@]} > 0 )); then
      icon_file="${icons[0]}"
    fi
  fi
  local has_icon=0
  if [[ -n "$icon_file" ]]; then
    cp "$icon_file" "$src_dir/.VolumeIcon.icns"
    chmod 0644 "$src_dir/.VolumeIcon.icns"
    has_icon=1
  fi

  local rw_dmg="$dmg_work/rw.dmg"
  if ! hdiutil_retry create -ov -volname "$vol_name" -srcfolder "$src_dir" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format UDRW "$rw_dmg" >/dev/null; then
    hdiutil_retry create -ov -volname "$vol_name" -srcfolder "$src_dir" -fs APFS -format UDRW "$rw_dmg" >/dev/null
  fi

  local mnt_dir="$dmg_work/mnt"
  mkdir -p "$mnt_dir"
  local attach_out
  attach_out="$(hdiutil attach -readwrite -noverify -noautoopen -nobrowse -mountpoint "$mnt_dir" "$rw_dmg")"
  ACTIVE_DMG_DISK="$(printf '%s\n' "$attach_out" | awk '/^\/dev\/disk/ { print $1; exit }')"
  if [[ -z "$ACTIVE_DMG_DISK" ]]; then
    echo "[valet] error: hdiutil attach did not return a disk device for $rw_dmg" >&2
    return 1
  fi

  if (( has_icon == 1 )); then
    /usr/bin/xattr -wx com.apple.FinderInfo 0000000000000000040000000000000000000000000000000000000000000000 "$mnt_dir"
  fi
  rm -rf "$mnt_dir/.fseventsd" "$mnt_dir/.Trashes"
  hdiutil_retry detach "$ACTIVE_DMG_DISK" >/dev/null
  ACTIVE_DMG_DISK=""

  local tmp_dmg="$dmg_work/$(basename "$dmg_path")"
  convert_dmg "$rw_dmg" "$tmp_dmg" >/dev/null
  codesign --force --sign "$SHA1" --timestamp=none "$tmp_dmg"
  mv -f "$tmp_dmg" "$dmg_path"
  rm -rf "$ACTIVE_DMG_WORK"
  ACTIVE_DMG_WORK=""
}

shopt -s nullglob
APP_BUNDLES=("$ROOT_DIR"/build/darwin-*/Valet.app)
shopt -u nullglob

if (( ${#APP_BUNDLES[@]} == 0 )); then
  exit 0
fi

for APP in "${APP_BUNDLES[@]}"; do
  echo "[valet] Signing $APP with \"$IDENTITY\" ($SHA1)..."
  RES_DIR="$APP/Contents/Resources"
  if [[ -d "$RES_DIR" ]]; then
    while IFS= read -r item; do
      [[ -z "$item" ]] && continue
      rel="${item#"$RES_DIR"/}"
      if [[ "$rel" == "bin/valet-bun" && -f "$ENTITLEMENTS_BUN" ]]; then
        codesign --force --sign "$SHA1" --timestamp=none --entitlements "$ENTITLEMENTS_BUN" "$item"
      else
        codesign --force --sign "$SHA1" --timestamp=none "$item"
      fi
    done < <(
      find "$RES_DIR" -type f | while IFS= read -r f; do
        if file -b "$f" 2>/dev/null | grep -q "Mach-O"; then
          slashes="${f//[^\/]/}"
          printf '%d\t%s\n' "${#slashes}" "$f"
        fi
      done | sort -rn -k1,1 | cut -f2-
    )
  fi

  # Sign outer app WITHOUT --deep so valet-bun retains sidecar.entitlements.plist
  codesign --force --sign "$SHA1" --timestamp=none "$APP"
  codesign --verify --deep --strict "$APP"

  BUN_BIN="$APP/Contents/Resources/bin/valet-bun"
  if [[ -f "$BUN_BIN" ]]; then
    if ! codesign -d --entitlements :- "$BUN_BIN" 2>/dev/null | grep -q "com.apple.security.cs.allow-jit"; then
      echo "[valet] error: $BUN_BIN missing com.apple.security.cs.allow-jit entitlement" >&2
      exit 1
    fi
  fi

  ARCH_DIR="$(dirname "$APP")"
  shopt -s nullglob
  DMG_FILES=("$ARCH_DIR"/*.dmg)
  shopt -u nullglob
  if (( ${#DMG_FILES[@]} > 0 )); then
    for DMG in "${DMG_FILES[@]}"; do
      echo "[valet] Rebuilding signed DMG: $DMG"
      rebuild_dmg_for_app "$APP" "$DMG"
    done
  fi

  echo "[valet] Designated requirement for $APP:"
  codesign -d -r - "$APP" 2>&1 || true
done
