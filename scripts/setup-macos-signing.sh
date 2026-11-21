#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "scripts/setup-macos-signing.sh 仅在 macOS 上运行。"
  exit 0
fi

IDENTITY="${VALET_LOCAL_SIGNING_IDENTITY:-Valet Local Dev}"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
if [[ ! -f "$LOGIN_KEYCHAIN" && -f "${HOME}/Library/Keychains/login.keychain" ]]; then
  LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain"
fi

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

EXISTING_SHA1="$(find_identity_sha1 "$IDENTITY" || true)"
if [[ -n "$EXISTING_SHA1" ]]; then
  echo "已检测到有效的本机代码签名身份：$IDENTITY ($EXISTING_SHA1)"
  exit 0
fi

# 必须使用 macOS 系统自带 LibreSSL (/usr/bin/openssl)，因为 Homebrew OpenSSL 3 默认生成 PBES2 PKCS#12，
# 会被 macOS security import 拒绝导入。
OPENSSL_BIN="/usr/bin/openssl"
if [[ ! -x "$OPENSSL_BIN" ]]; then
  echo "错误：未找到系统 LibreSSL ($OPENSSL_BIN)。" >&2
  exit 1
fi

TMPDIR_SIGN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SIGN"' EXIT

cat >"$TMPDIR_SIGN/cert.cnf" <<EOF
[ req ]
distinguished_name = req_distinguished_name
x509_extensions    = codesign_ext
prompt             = no

[ req_distinguished_name ]
CN = $IDENTITY
O  = Valet Local Development

[ codesign_ext ]
basicConstraints     = critical,CA:FALSE
keyUsage             = critical,digitalSignature
extendedKeyUsage     = critical,codeSigning
subjectKeyIdentifier = hash
EOF

"$OPENSSL_BIN" req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMPDIR_SIGN/key.pem" \
  -out "$TMPDIR_SIGN/cert.crt" \
  -days 3650 \
  -sha256 \
  -config "$TMPDIR_SIGN/cert.cnf" >/dev/null 2>&1

P12_PASS="$("$OPENSSL_BIN" rand -hex 16)"
"$OPENSSL_BIN" pkcs12 -export \
  -inkey "$TMPDIR_SIGN/key.pem" \
  -in "$TMPDIR_SIGN/cert.crt" \
  -out "$TMPDIR_SIGN/cert.p12" \
  -name "$IDENTITY" \
  -passout "pass:$P12_PASS"

security import "$TMPDIR_SIGN/cert.p12" \
  -k "$LOGIN_KEYCHAIN" \
  -P "$P12_PASS" \
  -T /usr/bin/codesign \
  -T /usr/bin/security

echo "正在将本机代码签名证书添加到登录钥匙串的 Code Signing 信任策略（可能需要一次 Touch ID / 登录密码确认）..."
if ! security add-trusted-cert -p codeSign -k "$LOGIN_KEYCHAIN" "$TMPDIR_SIGN/cert.crt"; then
  echo "未能完成证书信任授权。请重试并在系统弹窗中允许，或在「钥匙串访问」中将 \"$IDENTITY\" 的「代码签名」设为「始终信任」。" >&2
  exit 1
fi

NEW_SHA1="$(find_identity_sha1 "$IDENTITY" || true)"
if [[ -z "$NEW_SHA1" ]]; then
  echo "证书已导入但未通过 codesigning 身份校验：$IDENTITY。请在「钥匙串访问」中检查该证书的信任设置。" >&2
  exit 1
fi

echo "已就绪本机代码签名身份：$IDENTITY ($NEW_SHA1)"
