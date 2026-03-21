#!/bin/bash
# ============================================================
# ArmorClaw 跨平台客户端安装包打包脚本
# 支持 macOS (DMG)、Windows (NSIS exe)、Linux (AppImage/deb) 打包
#
# 用法:
#   ./install_package.sh                          # 打包当前平台、当前架构
#   ./install_package.sh --version 0.2.0          # 指定版本号打包
#   ./install_package.sh mac                      # 只打包 macOS (当前架构)
#   ./install_package.sh mac all                  # 打包 macOS x64 + arm64
#   ./install_package.sh win                      # 只打包 Windows (x64)
#   ./install_package.sh win x64                  # 打包 Windows x64
#   ./install_package.sh linux                    # 只打包 Linux (x64)
#   ./install_package.sh linux x64                # 打包 Linux x64
#   ./install_package.sh all                      # 同时打包 macOS + Windows + Linux (x64架构)
#   ./install_package.sh all all                  # 同时打包所有平台所有架构 (正式发布)
#   ./install_package.sh --version 1.0.0 all all  # 指定版本号打包所有平台
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$CLIENT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""
}

print_step() {
  echo -e "${GREEN}[$1] $2${NC}"
}

print_warn() {
  echo -e "${YELLOW}  ⚠ $1${NC}"
}

print_error() {
  echo -e "${RED}  ✗ $1${NC}"
}

# ============================================================
# 解析参数
# ============================================================
APP_VERSION=""
PLATFORM="auto"
ARCH="current"

# 解析命名参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v)
      if [ -z "${2:-}" ]; then
        print_error "--version 需要指定版本号"
        exit 1
      fi
      APP_VERSION="$2"
      shift 2
      ;;
    mac|macos|win|windows|linux|all|auto)
      PLATFORM="$1"
      shift
      ;;
    arm64|x64|current|all)
      ARCH="$1"
      shift
      ;;
    -h|--help)
      echo "用法: $0 [选项] [平台] [架构]"
      echo ""
      echo "选项:"
      echo "  --version, -v VER   指定版本号 (如: 0.2.0)"
      echo "  -h, --help          显示此帮助"
      echo ""
      echo "平台参数:"
      echo "  mac     只打包 macOS DMG"
      echo "  win     只打包 Windows NSIS 安装包"
      echo "  linux   只打包 Linux AppImage/deb"
      echo "  all     同时打包 macOS + Windows + Linux"
      echo "  auto    自动检测当前平台 (默认)"
      echo ""
      echo "架构参数:"
      echo "  current 当前机器架构 (默认)"
      echo "  arm64   ARM64 架构"
      echo "  x64     x64 架构"
      echo "  all     全部架构"
      echo ""
      echo "示例:"
      echo "  $0                              # 打包当前平台"
      echo "  $0 --version 0.2.0              # 指定版本号打包"
      echo "  $0 --version 1.0.0 all all      # 指定版本号打包所有平台"
      exit 0
      ;;
    *)
      print_error "未知参数: $1"
      exit 1
      ;;
  esac
done

# 检测当前操作系统
CURRENT_OS="$(uname -s)"
case "$CURRENT_OS" in
  Darwin) HOST_OS="mac" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) HOST_OS="win" ;;
  Linux) HOST_OS="linux" ;;
  *) HOST_OS="unknown" ;;
esac

# 平台参数解析
BUILD_MAC=false
BUILD_WIN=false
BUILD_LINUX=false

case "$PLATFORM" in
  mac|macos)
    BUILD_MAC=true
    ;;
  win|windows)
    BUILD_WIN=true
    ;;
  linux)
    BUILD_LINUX=true
    ;;
  all)
    BUILD_MAC=true
    BUILD_WIN=true
    BUILD_LINUX=true
    # 平台 all 时，架构也默认 all（除非显式指定）
    if [ "$ARCH" = "current" ]; then
      ARCH="all"
    fi
    ;;
  auto)
    # 自动检测：只构建当前平台
    if [ "$HOST_OS" = "mac" ]; then
      BUILD_MAC=true
    elif [ "$HOST_OS" = "win" ]; then
      BUILD_WIN=true
    elif [ "$HOST_OS" = "linux" ]; then
      BUILD_LINUX=true
    else
      print_error "无法自动检测平台，请指定: $0 [mac|win|linux|all]"
      exit 1
    fi
    ;;
  # 向后兼容：直接传架构参数（视为当前平台 + 指定架构）
  arm64|x64|current)
    ARCH="$PLATFORM"
    PLATFORM="auto"
    if [ "$HOST_OS" = "mac" ]; then
      BUILD_MAC=true
    elif [ "$HOST_OS" = "win" ]; then
      BUILD_WIN=true
    elif [ "$HOST_OS" = "linux" ]; then
      BUILD_LINUX=true
    fi
    ;;
  *)
    print_error "未知平台: $PLATFORM"
    exit 1
    ;;
esac

# ============================================================
# 解析架构参数（为每个平台生成对应的 flag）
# ============================================================
resolve_arch_flag() {
  local target_platform=$1
  local arch=$2

  case "$arch" in
    all)
      echo "--x64 --arm64"
      ;;
    arm64)
      echo "--arm64"
      ;;
    x64)
      echo "--x64"
      ;;
    current)
      local current_arch
      current_arch=$(uname -m)
      if [ "$current_arch" = "arm64" ] || [ "$current_arch" = "aarch64" ]; then
        echo "--arm64"
      else
        echo "--x64"
      fi
      ;;
    *)
      echo "--x64"
      ;;
  esac
}

# ============================================================
# 打印构建计划
# ============================================================
print_header "ArmorClaw 客户端安装包打包"

echo "  当前系统: $CURRENT_OS ($HOST_OS)"

# 显示/设置版本号
if [ -n "$APP_VERSION" ]; then
  echo "  版本号:   $APP_VERSION (指定)"
else
  # 从 package.json 读取当前版本
  APP_VERSION=$(node -p "require('./package.json').version")
  echo "  版本号:   $APP_VERSION (package.json)"
fi
echo ""

echo "  构建计划:"
if [ "$BUILD_MAC" = true ]; then
  MAC_ARCH_FLAG=$(resolve_arch_flag mac "$ARCH")
  echo -e "    ${GREEN}✓${NC} macOS DMG  (arch: $MAC_ARCH_FLAG)"
fi
if [ "$BUILD_WIN" = true ]; then
  WIN_ARCH_FLAG=$(resolve_arch_flag win "$ARCH")
  echo -e "    ${GREEN}✓${NC} Windows NSIS  (arch: $WIN_ARCH_FLAG)"
fi
if [ "$BUILD_LINUX" = true ]; then
  LINUX_ARCH_FLAG=$(resolve_arch_flag linux "$ARCH")
  echo -e "    ${GREEN}✓${NC} Linux AppImage/deb  (arch: $LINUX_ARCH_FLAG)"
fi
echo ""

# 跨平台打包警告
if [ "$BUILD_WIN" = true ] && [ "$HOST_OS" = "mac" ]; then
  print_warn "macOS 上跨平台打包 Windows：需要安装 wine (brew install --cask wine-stable)"
  print_warn "或使用 docker 进行跨平台构建 (推荐在 CI/CD 中完成)"
  echo ""
fi
if [ "$BUILD_MAC" = true ] && [ "$HOST_OS" != "mac" ]; then
  print_warn "非 macOS 系统无法打包 macOS DMG（Apple 代码签名限制）"
  print_warn "macOS 包必须在 macOS 上或 macOS CI 中构建"
  BUILD_MAC=false
  echo ""
fi

# ============================================================
# Step 0: 更新版本号（如果指定）
# ============================================================
TOTAL_STEPS=6
STEP=0

if [ -n "$APP_VERSION" ]; then
  CURRENT_PKG_VER=$(node -p "require('./package.json').version")
  if [ "$APP_VERSION" != "$CURRENT_PKG_VER" ]; then
    STEP=$((STEP + 1))
    TOTAL_STEPS=$((TOTAL_STEPS + 1))
    print_step "$STEP/$TOTAL_STEPS" "更新版本号: $CURRENT_PKG_VER -> $APP_VERSION"
    node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json')); pkg.version='$APP_VERSION'; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');"
    echo ""
  fi
fi

# ============================================================
# Step 1: 安装依赖
# ============================================================
STEP=$((STEP + 1))

print_step "$STEP/$TOTAL_STEPS" "安装依赖..."
npm install
# npm rebuild 确保 .bin/ 下为符号链接而非 shim 脚本
# （node_modules 若从 Git 克隆或跨平台复制而来，.bin/ 可能包含
#   Windows 风格的 shim 脚本，导致 macOS/Linux 上 require 路径错误）
npm rebuild
echo ""

# ============================================================
# Step 2: TypeScript 类型检查
# ============================================================
STEP=$((STEP + 1))
print_step "$STEP/$TOTAL_STEPS" "TypeScript 类型检查..."
npx tsc --noEmit
echo "  类型检查通过"
echo ""

# ============================================================
# Step 3: Vite 构建前端 + Electron
# ============================================================
STEP=$((STEP + 1))
print_step "$STEP/$TOTAL_STEPS" "Vite 构建..."
npx vite build
echo ""

# ============================================================
# Step 4: 重编译原生模块 (node-pty)
# ============================================================
STEP=$((STEP + 1))
print_step "$STEP/$TOTAL_STEPS" "重编译原生模块 (node-pty)..."
npx @electron/rebuild
echo "  原生模块编译完成"
echo ""

# ============================================================
# Step 5: 清理旧的安装包
# ============================================================
STEP=$((STEP + 1))
print_step "$STEP/$TOTAL_STEPS" "清理旧文件..."
if [ "$BUILD_MAC" = true ]; then
  rm -f SoftwarePackage/*.dmg SoftwarePackage/*.dmg.blockmap
  echo "  已清理 macOS DMG"
fi
if [ "$BUILD_WIN" = true ]; then
  rm -f SoftwarePackage/*.exe SoftwarePackage/*.exe.blockmap
  echo "  已清理 Windows 安装包"
fi
if [ "$BUILD_LINUX" = true ]; then
  rm -f SoftwarePackage/*.AppImage SoftwarePackage/*.deb
  echo "  已清理 Linux 安装包"
fi
echo ""

# ============================================================
# Step 6: electron-builder 打包
# ============================================================
STEP=$((STEP + 1))
print_step "$STEP/$TOTAL_STEPS" "打包安装程序..."

# --- macOS DMG ---
if [ "$BUILD_MAC" = true ]; then
  echo ""
  echo -e "  ${BLUE}▸ 打包 macOS DMG ...${NC}"
  npx electron-builder --mac dmg $MAC_ARCH_FLAG -c.mac.identity=null
  echo ""

  # 重命名 DMG，规范化命名格式：ArmorClaw-{version}-{arch}.dmg
  echo "  规范化文件名..."
  for dmg in SoftwarePackage/*.dmg; do
    [ -f "$dmg" ] || continue
    BASENAME=$(basename "$dmg")
    # electron-builder 默认输出: ArmorClaw-{version}-arm64.dmg 或 ArmorClaw-{version}.dmg
    if echo "$BASENAME" | grep -q "\-arm64\.dmg$"; then
      # 已有 arm64 后缀，保持不变
      echo "  $BASENAME (保持不变)"
    else
      # 无架构后缀，补上 -x64
      NEW_NAME="${dmg%.dmg}-x64.dmg"
      mv "$dmg" "$NEW_NAME"
      echo "  $BASENAME -> $(basename "$NEW_NAME")"
    fi
  done
  rm -f SoftwarePackage/*.dmg.blockmap
fi

# --- Windows NSIS ---
if [ "$BUILD_WIN" = true ]; then
  echo ""
  echo -e "  ${BLUE}▸ 打包 Windows NSIS 安装包 ...${NC}"
  npx electron-builder --win nsis $WIN_ARCH_FLAG
  echo ""

  # 重命名 exe，规范化命名格式：ArmorClaw-Setup-{version}-{arch}.exe
  echo "  规范化文件名..."
  for exe in SoftwarePackage/*.exe; do
    [ -f "$exe" ] || continue
    BASENAME=$(basename "$exe")
    # electron-builder 输出格式: ArmorClaw Setup {version}.exe 或 ArmorClaw Setup {version}-arm64.exe
    if echo "$BASENAME" | grep -q "\-arm64\.exe$"; then
      # 已有 arm64 后缀，将 " Setup " 改为 "-Setup-"
      NEW_NAME=$(echo "$exe" | sed 's/ Setup /-Setup-/' | sed 's/-arm64\.exe$/-arm64.exe/')
      if [ "$exe" != "$NEW_NAME" ]; then
        mv "$exe" "$NEW_NAME"
        echo "  $BASENAME -> $(basename "$NEW_NAME")"
      else
        echo "  $BASENAME (保持不变)"
      fi
    elif echo "$BASENAME" | grep -qi "setup"; then
      # x64 版本无架构后缀，补上 -x64
      NEW_NAME="${exe%.exe}-x64.exe"
      # 同时将 " Setup " 改为 "-Setup-"
      NEW_NAME=$(echo "$NEW_NAME" | sed 's/ Setup /-Setup-/')
      mv "$exe" "$NEW_NAME"
      echo "  $BASENAME -> $(basename "$NEW_NAME")"
    else
      echo "  $BASENAME (保持不变)"
    fi
  done
  rm -f SoftwarePackage/*.exe.blockmap
fi

# --- Linux AppImage/deb ---
if [ "$BUILD_LINUX" = true ]; then
  echo ""
  echo -e "  ${BLUE}▸ 打包 Linux AppImage/deb ...${NC}"
  npx electron-builder --linux AppImage deb $LINUX_ARCH_FLAG
  echo ""

  # 重命名 AppImage，规范化命名格式：ArmorClaw-{version}-{arch}.AppImage
  echo "  规范化文件名..."
  for appimage in SoftwarePackage/*.AppImage; do
    [ -f "$appimage" ] || continue
    BASENAME=$(basename "$appimage")
    if echo "$BASENAME" | grep -q "\-arm64\.AppImage$"; then
      # 已有 arm64 后缀，保持不变
      echo "  $BASENAME (保持不变)"
    else
      # 无架构后缀，补上 -x64
      NEW_NAME="${appimage%.AppImage}-x64.AppImage"
      mv "$appimage" "$NEW_NAME"
      echo "  $BASENAME -> $(basename "$NEW_NAME")"
    fi
  done

  # 重命名 deb，规范化命名格式：armorclaw_{version}_amd64.deb
  for debfile in SoftwarePackage/*.deb; do
    [ -f "$debfile" ] || continue
    BASENAME=$(basename "$debfile")
    # deb 文件名格式: armorclaw_{version}_amd64.deb，通常无需修改
    echo "  $BASENAME (保持不变)"
  done
fi

# ============================================================
# 显示结果
# ============================================================
print_header "打包完成!"

if [ "$BUILD_MAC" = true ]; then
  echo "  macOS DMG:"
  ls -lh SoftwarePackage/*.dmg 2>/dev/null | while read -r line; do echo "    $line"; done
  if ! ls SoftwarePackage/*.dmg 1>/dev/null 2>&1; then
    echo "    (未找到 DMG 文件)"
  fi
  echo ""
fi

if [ "$BUILD_WIN" = true ]; then
  echo "  Windows 安装包:"
  ls -lh SoftwarePackage/*.exe 2>/dev/null | while read -r line; do echo "    $line"; done
  if ! ls SoftwarePackage/*.exe 1>/dev/null 2>&1; then
    echo "    (未找到 exe 文件)"
  fi
  echo ""
fi

if [ "$BUILD_LINUX" = true ]; then
  echo "  Linux 安装包:"
  ls -lh SoftwarePackage/*.AppImage SoftwarePackage/*.deb 2>/dev/null | while read -r line; do echo "    $line"; done
  if ! ls SoftwarePackage/*.AppImage 1>/dev/null 2>&1 && ! ls SoftwarePackage/*.deb 1>/dev/null 2>&1; then
    echo "    (未找到 Linux 安装包)"
  fi
  echo ""
fi
