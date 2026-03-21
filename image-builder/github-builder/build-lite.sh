#!/usr/bin/env bash
# ArmorClaw Image Builder - Lite Build Script (Global)
# ============================================================
# Builds the base image only (openclaw core + Node.js + Go + Python),
# without pre-installing any skill dependency tools.
# Tags the result as armorclaw:lite.
#
# Difference from build.sh:
#   - build.sh: builds base + full (with all skill tools pre-installed)
#   - build-lite.sh: builds base only, tags as armorclaw:lite
#
# Usage:
#   bash build-lite.sh [options]
#   bash build-lite.sh --local ../openclaw --skip-base
# ============================================================
set -euo pipefail
export DOCKER_BUILDKIT=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

if [ -f "$SCRIPT_DIR/config.env" ]; then
    source "$SCRIPT_DIR/config.env"
else
    log_error "config.env not found"; exit 1
fi

LOCAL_SRC=""; SKIP_BASE=false; NO_CACHE=""; VERBOSE=false; VERSION="${OPENCLAW_VERSION:-main}"; PUSH=false; INSTALL_BROWSER=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)
            [ -z "${2:-}" ] && { log_error "--local requires a path"; exit 1; }
            LOCAL_SRC="$(cd "$2" && pwd)"; shift 2 ;;
        --skip-base) SKIP_BASE=true; shift ;;
        --no-cache) NO_CACHE="--no-cache"; shift ;;
        --verbose) VERBOSE=true; shift ;;
        --push) PUSH=true; shift ;;
        --browser) INSTALL_BROWSER=true; shift ;;
        --version)
            [ -z "${2:-}" ] && { log_error "--version requires a version string"; exit 1; }
            VERSION="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: bash build-lite.sh [--local PATH] [--skip-base] [--no-cache] [--verbose] [--push] [--browser] [--version VER]"
            echo ""
            echo "Options:"
            echo "  --local PATH   Use local openclaw source directory"
            echo "  --skip-base    Skip base image build (must already exist)"
            echo "  --no-cache     Disable Docker build cache"
            echo "  --verbose      Show detailed verification output"
            echo "  --push         Push image to remote registry after build"
            echo "  --browser      Pre-install Chromium browser (for browser-automation skill, adds ~300MB)"
            echo "  --version VER  Specify openclaw version/branch/tag"
            exit 0 ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

log_info "Checking build environment..."
for cmd in docker git curl; do command -v "$cmd" &>/dev/null || { log_error "Missing: $cmd"; exit 1; }; done
docker info &>/dev/null || { log_error "Docker daemon is not running"; exit 1; }
log_ok "Environment check passed"

# ============================================================
# Detect build machine architecture
# ============================================================
DETECT_ARCH=$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)
case "$DETECT_ARCH" in
    x86_64|amd64) BUILD_ARCH="amd64" ;;
    aarch64|arm64) BUILD_ARCH="arm64" ;;
    *) BUILD_ARCH="amd64"; log_warn "Unknown arch $DETECT_ARCH, defaulting to amd64" ;;
esac

echo ""

# ============================================================
# Clone / update OpenClaw source (GitHub primary)
# ============================================================
SRC_DIR="$SCRIPT_DIR/.openclaw-src"

REPO_OPENCLAW_DIR="$(cd "$BUILDER_ROOT/.." && pwd)/openclaw"
if [ -n "$LOCAL_SRC" ]; then
    [ -f "$LOCAL_SRC/Dockerfile" ] || { log_error "Local path missing Dockerfile"; exit 1; }
    SRC_DIR="$LOCAL_SRC"; log_info "Using local source: $SRC_DIR"
elif [ -f "$REPO_OPENCLAW_DIR/Dockerfile" ]; then
    SRC_DIR="$REPO_OPENCLAW_DIR"
    log_info "Detected in-repo openclaw/ directory, using: $SRC_DIR"
elif [ -d "$SRC_DIR/.git" ]; then
    log_info "Updating source to: $VERSION"
    cd "$SRC_DIR"
    if ! git fetch --depth 1 origin "$VERSION" 2>/dev/null; then
        log_warn "Shallow fetch failed, trying full fetch..."
        git fetch origin || { log_error "git fetch failed, check network or version: $VERSION"; exit 1; }
    fi
    git checkout "origin/$VERSION" 2>/dev/null || git checkout FETCH_HEAD 2>/dev/null || git checkout "$VERSION" || \
        { log_error "Cannot checkout version: $VERSION"; exit 1; }
    cd "$SCRIPT_DIR"; log_ok "Source updated"
else
    log_info "Cloning openclaw source..."
    REPO="${OPENCLAW_REPO:-https://github.com/nicepkg/openclaw.git}"
    REPO_FALLBACK="${OPENCLAW_REPO_FALLBACK:-}"

    CLONED=false
    log_info "  Trying primary: $REPO"
    if git clone --depth 1 --branch "$VERSION" "$REPO" "$SRC_DIR" 2>/dev/null || \
       git clone --depth 1 "$REPO" "$SRC_DIR" 2>/dev/null; then
        CLONED=true
        log_ok "  Primary source cloned"
    else
        log_warn "  Primary source failed"
    fi

    if [ "$CLONED" = false ] && [ -n "$REPO_FALLBACK" ]; then
        log_info "  Trying fallback: $REPO_FALLBACK"
        if git clone --depth 1 --branch "$VERSION" "$REPO_FALLBACK" "$SRC_DIR" 2>/dev/null || \
           git clone --depth 1 "$REPO_FALLBACK" "$SRC_DIR" 2>/dev/null; then
            CLONED=true
            log_ok "  Fallback source cloned"
        fi
    fi

    [ "$CLONED" = true ] || { log_error "All source repositories failed, check your network"; exit 1; }
    log_ok "Source clone complete"
fi

# ============================================================
# Build base image
# ============================================================

BASE_IMAGE="${BASE_IMAGE_NAME:-openclaw:base}"
LITE_IMAGE="${LITE_IMAGE_NAME:-armorclaw:lite}"

if [ "$SKIP_BASE" = true ]; then
    docker image inspect "$BASE_IMAGE" &>/dev/null || { log_error "Base image not found, cannot --skip-base"; exit 1; }
    log_warn "Skipping base build"
else
    # ---- Compatibility patches for the upstream Dockerfile ----
    # Place patched Dockerfile inside the build context ($SRC_DIR) so Docker BuildKit
    # can correctly find the co-located .dockerignore.
    PATCHED_DOCKERFILE="$SRC_DIR/.Dockerfile.patched"
    cp "$SRC_DIR/Dockerfile" "$PATCHED_DOCKERFILE"

    # 移除 BuildKit 语法前端声明（# syntax=docker/dockerfile:...）
    # 避免 BuildKit 从 Docker Hub 拉取语法解析器镜像（网络不可达时会超时）
    sed -i.bak '/^# syntax=docker\/dockerfile/d' "$PATCHED_DOCKERFILE"

    # 去掉 FROM 行的 @sha256:... digest 锁定
    # 带 digest 时镜像加速器无法使用
    if grep -q '@sha256:' "$PATCHED_DOCKERFILE"; then
        sed -i.bak 's/@sha256:[a-f0-9]\{64\}//' "$PATCHED_DOCKERFILE"
        log_info "已去除基础镜像 digest 锁定（兼容镜像加速器）"
    fi

    # Remove A2UI source and create stub bundle so bundle-a2ui.sh skips compilation
    # (Docker tsc/rolldown compilation of A2UI may fail due to environment differences)
    sed -i.bak 's|RUN pnpm build|RUN rm -rf vendor/a2ui apps/shared/OpenClawKit/Tools/CanvasA2UI \&\& mkdir -p src/canvas-host/a2ui \&\& echo "/\\* A2UI stub */" > src/canvas-host/a2ui/a2ui.bundle.js \&\& echo "stub" > src/canvas-host/a2ui/.bundle.hash \&\& pnpm build|' "$PATCHED_DOCKERFILE"

    # Windows Docker Desktop (BuildKit) COPY may silently drop some files
    # (e.g. IDENTITY.md, USER.md). Workaround: tar the templates directory
    # and unpack during RUN to bypass COPY file-loss behavior.
    TEMPLATES_DIR="$SRC_DIR/docs/reference/templates"
    TEMPLATES_TAR="$SRC_DIR/.templates-backup.tar"
    if [ -d "$TEMPLATES_DIR" ]; then
        tar cf "$TEMPLATES_TAR" -C "$SRC_DIR" docs/reference/templates/
        sed -i.bak 's|RUN rm -rf vendor/a2ui apps/shared/OpenClawKit/Tools/CanvasA2UI|RUN tar xf .templates-backup.tar 2>/dev/null; rm -f .templates-backup.tar; rm -rf vendor/a2ui apps/shared/OpenClawKit/Tools/CanvasA2UI|' "$PATCHED_DOCKERFILE"
        log_info "Backed up templates directory and injected tar unpack step"
    fi

    rm -f "$PATCHED_DOCKERFILE.bak"

    log_info "Building base image: $BASE_IMAGE"
    BUILD_ARGS=()
    [ -n "$NO_CACHE" ] && BUILD_ARGS+=("$NO_CACHE")
    [ -n "${GO_VERSION:-}" ] && BUILD_ARGS+=(--build-arg "GO_VERSION=$GO_VERSION")
    if [ "$INSTALL_BROWSER" = true ]; then
        BUILD_ARGS+=(--build-arg "OPENCLAW_INSTALL_BROWSER=1")
        log_info "Browser pre-install enabled (Chromium + Playwright + Xvfb)"
    fi
    docker build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} -t "$BASE_IMAGE" -f "$PATCHED_DOCKERFILE" "$SRC_DIR"

    rm -f "$PATCHED_DOCKERFILE" "$SRC_DIR/.bun-prebuilt"
    log_ok "Base image build complete"
fi

# ============================================================
# Tag base image as lite
# ============================================================

log_info "Tagging base image as lite: $LITE_IMAGE"
docker tag "$BASE_IMAGE" "$LITE_IMAGE"
log_ok "Lite image ready: $LITE_IMAGE"

# ============================================================
# Version tag
# ============================================================

BUILD_DATE=$(date +%Y%m%d)
SAFE_VERSION="${VERSION//\//-}"
VERSION_TAG="${LITE_IMAGE}-${SAFE_VERSION}-${BUILD_DATE}"
docker tag "$LITE_IMAGE" "$VERSION_TAG" 2>/dev/null && log_info "Version tag: $VERSION_TAG" || true

# ============================================================
# Verify base tools (lite image only contains tools from base)
# ============================================================

log_info "Verifying base tools..."
BASE_TOOLS=(
    node npm npx pnpm
    go
    python3 pip3 uv
    git curl jq gh
)
OK=0; FAIL=0
for t in "${BASE_TOOLS[@]}"; do
    if docker run --rm "$LITE_IMAGE" sh -c "which $t" &>/dev/null; then
        OK=$((OK + 1))
        [ "$VERBOSE" = true ] && log_ok "  $t"
    else
        FAIL=$((FAIL + 1))
        log_warn "  $t - not found"
    fi
done

echo -e "\n========== Build Report =========="
echo "Image: $LITE_IMAGE"
echo "Size:  $(docker image inspect "$LITE_IMAGE" --format='{{.Size}}' | awk '{printf "%.1f GB", $1/1024/1024/1024}')"
echo "Tools: $OK/${#BASE_TOOLS[@]} passed, $FAIL/${#BASE_TOOLS[@]} failed"
echo "Mode:  Lite (no skill pre-installed tools)"
echo "=================================="

# ============================================================
# Push image to remote registry
# ============================================================

if [ "$PUSH" = true ]; then
    REGISTRY="${REGISTRY:-ghcr.io}"
    REGISTRY_IMAGE="${REGISTRY_IMAGE:-}"
    if [ -z "$REGISTRY_IMAGE" ]; then
        log_error "Push requires REGISTRY_IMAGE to be set (configure in config.env)"
        exit 1
    fi
    LITE_REGISTRY="${REGISTRY_IMAGE}-lite"
    log_info "Pushing image to: $LITE_REGISTRY"
    docker tag "$LITE_IMAGE" "$LITE_REGISTRY:latest"
    docker tag "$LITE_IMAGE" "$LITE_REGISTRY:${SAFE_VERSION}-${BUILD_DATE}"
    docker push "$LITE_REGISTRY:latest" || { log_error "Failed to push latest tag"; exit 1; }
    docker push "$LITE_REGISTRY:${SAFE_VERSION}-${BUILD_DATE}" || { log_error "Failed to push version tag"; exit 1; }
    log_ok "Image pushed: $LITE_REGISTRY"
fi

log_ok "Lite build complete!"
