#!/usr/bin/env bash
# ============================================================
# ArmorClaw Lite - One-click Build + Package (Global)
# ============================================================
# Difference from build-and-package.sh:
#   - Builds base image only (no pre-installed skill tools), tagged armorclaw:lite
#   - Smaller exported tar.gz, faster packaging, smaller installer
#   - Users install skill dependencies on-demand (via client skill page)
#
# Usage:
#   bash build-and-package-lite.sh              # Full pipeline (current arch)
#   bash build-and-package-lite.sh --arch all   # Package x64 + arm64 client installers
#
# Options:
#   --skip-build      Skip image build (use existing image for export+package)
#   --skip-package    Build+export only, skip client packaging
#   --image-only      Build+export+place in client/resources/ (no installer)
#   --no-image        Package client without embedded image (lightweight)
#   --platform mac    Target platform (mac|win|linux|all)
#   --arch x64        Target architecture (x64|arm64|all)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$BUILDER_ROOT/.." && pwd)"
CLIENT_DIR="$PROJECT_DIR/client"
RESOURCES_DIR="$CLIENT_DIR/resources"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ============================================================
# Default parameters
# ============================================================
SKIP_BUILD=false
SKIP_PACKAGE=false
IMAGE_ONLY=false
NO_IMAGE=false
CLIENT_PLATFORM=""
CLIENT_ARCH=""
BUILD_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build)
            SKIP_BUILD=true; shift ;;
        --skip-package)
            SKIP_PACKAGE=true; shift ;;
        --image-only)
            IMAGE_ONLY=true; shift ;;
        --no-image)
            NO_IMAGE=true; shift ;;
        --platform)
            [ -z "${2:-}" ] && { log_error "--platform requires mac|win|linux|all"; exit 1; }
            CLIENT_PLATFORM="$2"; shift 2 ;;
        --arch)
            [ -z "${2:-}" ] && { log_error "--arch requires x64|arm64|all"; exit 1; }
            CLIENT_ARCH="$2"; shift 2 ;;
        --skip-base|--no-cache|--verbose|--push|--browser)
            BUILD_ARGS+=("$1"); shift ;;
        --version|--local)
            [ -z "${2:-}" ] && { log_error "$1 requires an argument"; exit 1; }
            BUILD_ARGS+=("$1" "$2"); shift 2 ;;
        -h|--help)
            cat <<'EOF'
Usage: bash build-and-package-lite.sh [options]

Lite version: builds base image only (no skill pre-installed tools), smaller installer.

Pipeline control:
  --skip-build          Skip image build (use existing Docker image)
  --skip-package        Build+export only, skip client packaging
  --image-only          Build+export+place in client/resources/ (no installer)
  --no-image            Package client without embedded image (lightweight)

Client packaging:
  --platform PLATFORM   Target platform: mac | win | linux | all (default: auto-detect)
  --arch ARCH           Target architecture: x64 | arm64 | all (default: current)

Image build (passed through to build-lite.sh):
  --skip-base           Skip base image build
  --no-cache            Disable Docker build cache
  --verbose             Show detailed output
  --version VER         Specify openclaw version
  --local PATH          Use local openclaw source
  --browser             Pre-install Chromium (for browser-automation skill)
  --push                Push image to remote registry after build

Notes:
  --arch all makes electron-builder produce both x64 and arm64 client installers.
  Docker image is built for current machine arch only (embedded in installer).

Examples:
  bash build-and-package-lite.sh                          # Full pipeline (current arch)
  bash build-and-package-lite.sh --arch all               # x64 + arm64 client installers
  bash build-and-package-lite.sh --skip-build             # Image exists, export+package only
  bash build-and-package-lite.sh --platform mac --arch all
  bash build-and-package-lite.sh --platform win --arch x64
EOF
            exit 0 ;;
        *) log_error "Unknown option: $1 (use --help for usage)"; exit 1 ;;
    esac
done

# ============================================================
# Parameter logic
# ============================================================
if [ "$IMAGE_ONLY" = true ]; then
    SKIP_PACKAGE=true
fi

if [ "$SKIP_PACKAGE" = false ] && [ -z "$CLIENT_PLATFORM" ]; then
    HOST_OS="$(uname -s)"
    if [ "$HOST_OS" = "Linux" ]; then
        log_error "Linux build server requires --platform parameter for client packaging"
        log_info "Example: bash build-and-package-lite.sh --platform mac"
        exit 1
    fi
fi

# ============================================================
# Detect build machine architecture
# ============================================================
DETECT_ARCH=$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)
case "$DETECT_ARCH" in
    x86_64|amd64) BUILD_ARCH="amd64" ;;
    aarch64|arm64) BUILD_ARCH="arm64" ;;
    *) BUILD_ARCH="amd64"; log_warn "Unknown arch $DETECT_ARCH, defaulting to amd64" ;;
esac

# Read image name from config.env
if [ -f "$SCRIPT_DIR/config.env" ]; then
    source "$SCRIPT_DIR/config.env"
fi
LITE_IMAGE="${LITE_IMAGE_NAME:-armorclaw:lite}"
TAR_FILENAME="armorclaw-${BUILD_ARCH}.tar.gz"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  ArmorClaw Lite - Build + Package${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "  Architecture:  ${BUILD_ARCH}"
echo "  Image:         ${LITE_IMAGE} (lite, no skill pre-installed tools)"
echo "  Export file:   ${TAR_FILENAME}"
echo "  Project dir:   ${PROJECT_DIR}"
echo ""
echo "  Pipeline:"
if [ "$SKIP_BUILD" = true ]; then
    echo -e "    ${YELLOW}○${NC} Image build (skipped)"
else
    echo -e "    ${GREEN}●${NC} Image build (lite)"
fi
if [ "$NO_IMAGE" = true ]; then
    echo -e "    ${YELLOW}○${NC} Export image (skipped, lightweight mode)"
else
    echo -e "    ${GREEN}●${NC} Export image -> ${TAR_FILENAME}"
fi
if [ "$SKIP_PACKAGE" = true ]; then
    echo -e "    ${YELLOW}○${NC} Client packaging (skipped)"
else
    echo -e "    ${GREEN}●${NC} Client packaging (platform: ${CLIENT_PLATFORM:-auto}, arch: ${CLIENT_ARCH:-current})"
fi
echo ""

# ============================================================
# Step 1: Build lite Docker image
# ============================================================
TOTAL_STEPS=4
CURRENT_STEP=0

if [ "$SKIP_BUILD" = false ]; then
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo -e "${GREEN}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Building lite Docker image (${BUILD_ARCH})..."
    echo ""

    bash "$SCRIPT_DIR/build-lite.sh" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}

    echo ""
    log_ok "Lite image build complete"
else
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Skipping image build"

    if ! docker image inspect "$LITE_IMAGE" &>/dev/null; then
        log_error "Image ${LITE_IMAGE} not found, build first or remove --skip-build"
        exit 1
    fi
    log_ok "Image confirmed: ${LITE_IMAGE}"
fi

# ============================================================
# Step 2: Export image as tar.gz
# ============================================================
CURRENT_STEP=$((CURRENT_STEP + 1))

if [ "$NO_IMAGE" = false ]; then
    echo ""
    echo -e "${GREEN}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Exporting image as ${TAR_FILENAME} ..."

    EXPORT_PATH="$RESOURCES_DIR/$TAR_FILENAME"
    mkdir -p "$RESOURCES_DIR"
    rm -f "$EXPORT_PATH"

    IMAGE_SIZE=$(docker image inspect "$LITE_IMAGE" --format='{{.Size}}' | awk '{printf "%.1f", $1/1024/1024/1024}')
    log_info "Image virtual size: ${IMAGE_SIZE}GB, exporting+compressing (may take a few minutes)..."

    docker save "$LITE_IMAGE" | gzip > "$EXPORT_PATH"

    EXPORT_SIZE=$(du -h "$EXPORT_PATH" | awk '{print $1}')
    log_ok "Export complete: ${EXPORT_PATH} (${EXPORT_SIZE})"
else
    echo ""
    echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Skipping image export (lightweight mode)"

    if ls "$RESOURCES_DIR"/armorclaw-*.tar.gz 1>/dev/null 2>&1 || \
       [ -f "$RESOURCES_DIR/armorclaw.tar.gz" ]; then
        log_info "Cleaning old image files from resources directory..."
        rm -f "$RESOURCES_DIR"/armorclaw-*.tar.gz "$RESOURCES_DIR/armorclaw.tar.gz"
    fi
fi

# ============================================================
# Step 3: Check client packaging environment
# ============================================================
CURRENT_STEP=$((CURRENT_STEP + 1))

if [ "$SKIP_PACKAGE" = false ]; then
    echo ""
    echo -e "${GREEN}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Checking client packaging environment..."

    if ! command -v node &>/dev/null; then
        log_error "Node.js not installed, required for client packaging"
        exit 1
    fi
    NODE_VER=$(node --version)
    log_ok "Node.js: ${NODE_VER}"

    if ! command -v npm &>/dev/null; then
        log_error "npm not installed"
        exit 1
    fi
    log_ok "npm: $(npm --version)"

    PACKAGE_SCRIPT="$CLIENT_DIR/SoftwarePackage/install_package.sh"
    if [ ! -f "$PACKAGE_SCRIPT" ]; then
        log_error "Client packaging script not found: ${PACKAGE_SCRIPT}"
        exit 1
    fi

    echo ""
    log_info "client/resources/ contents:"
    ls -lh "$RESOURCES_DIR"/ 2>/dev/null | grep -v "^total" | awk '{print "  " $NF " (" $5 ")"}' || echo "  (empty)"
else
    echo ""
    echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Skipping client packaging"
fi

# ============================================================
# Step 4: Package client installer
# ============================================================
CURRENT_STEP=$((CURRENT_STEP + 1))

if [ "$SKIP_PACKAGE" = false ]; then
    echo ""
    echo -e "${GREEN}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Packaging client installer..."
    echo ""

    # Clean old Electron build artifacts to ensure fresh vite build
    log_info "Cleaning old build artifacts (dist-electron/)..."
    rm -rf "$CLIENT_DIR/dist-electron"

    PACKAGE_ARGS=()
    [ -n "$CLIENT_PLATFORM" ] && PACKAGE_ARGS+=("$CLIENT_PLATFORM")
    [ -n "$CLIENT_ARCH" ] && PACKAGE_ARGS+=("$CLIENT_ARCH")

    bash "$PACKAGE_SCRIPT" ${PACKAGE_ARGS[@]+"${PACKAGE_ARGS[@]}"}

    echo ""
    log_ok "Client packaging complete"
else
    echo ""
    echo -e "${YELLOW}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} Skipping client packaging"
fi

# ============================================================
# Summary report
# ============================================================
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Done! (Lite)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$SKIP_BUILD" = false ] || docker image inspect "$LITE_IMAGE" &>/dev/null 2>&1; then
    FINAL_SIZE=$(docker image inspect "$LITE_IMAGE" --format='{{.Size}}' 2>/dev/null | awk '{printf "%.1f GB", $1/1024/1024/1024}')
    echo "  Docker image:  ${LITE_IMAGE} (${FINAL_SIZE}) [${BUILD_ARCH}, lite]"
fi

if [ "$NO_IMAGE" = false ] && [ -f "$RESOURCES_DIR/$TAR_FILENAME" ]; then
    TAR_SIZE=$(du -h "$RESOURCES_DIR/$TAR_FILENAME" | awk '{print $1}')
    echo "  Image archive: ${TAR_FILENAME} (${TAR_SIZE})"
fi

if [ "$SKIP_PACKAGE" = false ]; then
    echo ""
    echo "  Installer output: $CLIENT_DIR/SoftwarePackage/"
    if ls "$CLIENT_DIR/SoftwarePackage/"*.dmg 1>/dev/null 2>&1; then
        echo "  macOS DMG:"
        ls -lh "$CLIENT_DIR/SoftwarePackage/"*.dmg 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
    fi
    if ls "$CLIENT_DIR/SoftwarePackage/"*.exe 1>/dev/null 2>&1; then
        echo "  Windows exe:"
        ls -lh "$CLIENT_DIR/SoftwarePackage/"*.exe 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
    fi
    if ls "$CLIENT_DIR/SoftwarePackage/"*.AppImage 1>/dev/null 2>&1 || ls "$CLIENT_DIR/SoftwarePackage/"*.deb 1>/dev/null 2>&1; then
        echo "  Linux packages:"
        ls -lh "$CLIENT_DIR/SoftwarePackage/"*.AppImage "$CLIENT_DIR/SoftwarePackage/"*.deb 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
    fi
fi

echo ""
echo -e "${YELLOW}Note: Lite version does not include pre-installed skill tools. Users can install dependencies on-demand via the client skill page.${NC}"
echo ""
