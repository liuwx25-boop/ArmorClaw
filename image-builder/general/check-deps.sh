#!/usr/bin/env bash
# ============================================================
# ArmorClaw - Skill 依赖同步检查脚本
# ============================================================
# 自动解析 openclaw/skills/*/SKILL.md 的 YAML frontmatter，
# 提取所有 requires.bins 和 install 定义，与 Dockerfile.full 中
# 实际安装的工具对比，输出差异报告。
#
# 用法:
#   bash check-deps.sh [--src PATH]
#
# 参数:
#   --src PATH  指定 openclaw 源码路径（默认: .openclaw-src）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 默认源码路径
BUILDER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$BUILDER_ROOT/gitee-builder/.openclaw-src"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --src)
            [ -z "${2:-}" ] && { log_error "--src 需要指定路径"; exit 1; }
            SRC_DIR="$(cd "$2" && pwd)"; shift 2 ;;
        -h|--help)
            echo "用法: bash check-deps.sh [--src PATH]"
            echo "  --src PATH  指定 openclaw 源码路径（默认: .openclaw-src）"
            exit 0 ;;
        *) log_error "未知参数: $1"; exit 1 ;;
    esac
done

SKILLS_DIR="$SRC_DIR/skills"
DOCKERFILE="$BUILDER_ROOT/gitee-builder/Dockerfile.full"

# 自动检测：如果仓库内自带 openclaw/ 目录，使用它
REPO_OPENCLAW_DIR="$(cd "$BUILDER_ROOT/.." && pwd)/openclaw"
if [ ! -d "$SKILLS_DIR" ] && [ -d "$REPO_OPENCLAW_DIR/skills" ]; then
    SRC_DIR="$REPO_OPENCLAW_DIR"
    SKILLS_DIR="$SRC_DIR/skills"
    log_info "自动检测到仓库内 openclaw/ 目录: $SRC_DIR"
fi

[ -d "$SKILLS_DIR" ] || { log_error "skills 目录不存在: $SKILLS_DIR"; exit 1; }
[ -f "$DOCKERFILE" ] || { log_error "Dockerfile.full 不存在: $DOCKERFILE"; exit 1; }

# ============================================================
# Step 1: 从 Dockerfile.full 提取已安装的工具
# ============================================================
log_info "解析 Dockerfile.full 已安装工具..."

declare -A INSTALLED_TOOLS

# 提取 npm install -g 的包（取最后一个路径段作为 bin 名）
while IFS= read -r pkg; do
    bin=$(echo "$pkg" | sed 's|.*/||; s|@.*||')
    INSTALLED_TOOLS["$bin"]=1
done < <(grep -oP 'npm install -g \K[^\s)]+' "$DOCKERFILE" 2>/dev/null || true)

# 提取 go install 的模块（取最后一个路径段作为 bin 名）
while IFS= read -r mod; do
    bin=$(echo "$mod" | sed 's|.*/||; s|@.*||')
    INSTALLED_TOOLS["$bin"]=1
done < <(grep -oP 'go install \K[^\s)]+' "$DOCKERFILE" 2>/dev/null || true)

# 提取预编译二进制（从 chmod +x 行提取）
while IFS= read -r path; do
    bin=$(basename "$path")
    INSTALLED_TOOLS["$bin"]=1
done < <(grep -oP 'chmod \+x /usr/local/bin/\K\S+' "$DOCKERFILE" 2>/dev/null || true)

# 提取 pip3 install 的包
while IFS= read -r pkg; do
    INSTALLED_TOOLS["$pkg"]=1
done < <(grep -oP 'pip3 install[^\\]*\K[a-zA-Z0-9_-]+(?=\s*\)|$)' "$DOCKERFILE" 2>/dev/null || true)

# 提取 uv tool install 的包
while IFS= read -r pkg; do
    INSTALLED_TOOLS["$pkg"]=1
done < <(grep -oP 'uv tool install \K[^\s&)]+' "$DOCKERFILE" 2>/dev/null || true)

# 提取 apt-get install 的包
while IFS= read -r pkg; do
    INSTALLED_TOOLS["$pkg"]=1
done < <(grep -oP 'apt-get install -y \K[^\s&]+' "$DOCKERFILE" 2>/dev/null || true)

log_ok "已安装工具数: ${#INSTALLED_TOOLS[@]}"

# ============================================================
# Step 2: 从 SKILL.md 提取所有 skill 的 bin 依赖
# ============================================================
log_info "解析 skills/*/SKILL.md 依赖声明..."

declare -A SKILL_BINS          # bin -> skill_name
declare -A SKILL_INSTALL_KIND  # bin -> install_kind (brew/node/go/uv/download)
declare -A SKILL_OS            # bin -> os (darwin/linux/留空=all)
declare -A ANYBINS             # bin -> skill_name (anyBins 中的)
TOTAL_SKILLS=0
SKILLS_WITH_BINS=0

for skill_dir in "$SKILLS_DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    skill_md="$skill_dir/SKILL.md"
    [ -f "$skill_md" ] || continue
    ((TOTAL_SKILLS++))

    # 提取 frontmatter（--- 到 --- 之间的内容）
    frontmatter=$(awk '/^---$/{if(n++)exit;next}n' "$skill_md" 2>/dev/null || true)
    [ -z "$frontmatter" ] && continue

    # 检查是否有 os 限定
    os_limit=$(echo "$frontmatter" | grep -oP '"os"\s*:\s*\[?"?\K[a-z0-9]+' 2>/dev/null | head -1 || true)

    # 提取 requires.bins 数组中的值
    bins=$(echo "$frontmatter" | grep -oP '"bins"\s*:\s*\[\K[^\]]+' 2>/dev/null | head -1 || true)
    if [ -n "$bins" ]; then
        ((SKILLS_WITH_BINS++))
        for bin in $(echo "$bins" | tr ',' '\n' | sed 's/[" ]//g'); do
            [ -z "$bin" ] && continue
            SKILL_BINS["$bin"]="$skill_name"
            [ -n "$os_limit" ] && SKILL_OS["$bin"]="$os_limit"
        done
    fi

    # 提取 requires.anyBins 数组中的值
    anybins=$(echo "$frontmatter" | grep -oP '"anyBins"\s*:\s*\[\K[^\]]+' 2>/dev/null | head -1 || true)
    if [ -n "$anybins" ]; then
        [ -z "$bins" ] && ((SKILLS_WITH_BINS++))
        for bin in $(echo "$anybins" | tr ',' '\n' | sed 's/[" ]//g'); do
            [ -z "$bin" ] && continue
            ANYBINS["$bin"]="$skill_name"
            [ -n "$os_limit" ] && SKILL_OS["$bin"]="$os_limit"
        done
    fi

    # 提取 install 中的 kind
    install_kinds=$(echo "$frontmatter" | grep -oP '"kind"\s*:\s*"\K[^"]+' 2>/dev/null || true)
    if [ -n "$install_kinds" ]; then
        first_kind=$(echo "$install_kinds" | head -1)
        for bin in $(echo "$bins" | tr ',' '\n' | sed 's/[" ]//g'); do
            [ -z "$bin" ] && continue
            SKILL_INSTALL_KIND["$bin"]="$first_kind"
        done
    fi
done

log_ok "总 skill 数: $TOTAL_SKILLS, 有 bin 依赖的: $SKILLS_WITH_BINS"

# ============================================================
# Step 3: 基础镜像已有的工具（不需要在 Dockerfile.full 安装）
# ============================================================

declare -A BASE_TOOLS
for t in jq rg ripgrep tmux ffmpeg gh git python3 pip3 uv curl node npm pnpm bun; do
    BASE_TOOLS["$t"]=1
done

# ============================================================
# Step 4: 已知 darwin-only 工具（Linux Docker 中无法运行）
# ============================================================

declare -A DARWIN_ONLY
for t in remindctl memo imsg peekaboo codexbar gog sag spogo spotify_player gemini; do
    DARWIN_ONLY["$t"]=1
done

# ============================================================
# Step 5: 对比并输出报告
# ============================================================

echo ""
echo -e "${CYAN}========== 依赖同步检查报告 ==========${NC}"
echo ""

MISSING=0
COVERED=0
DARWIN_COUNT=0
BASE_COUNT=0
ANY_COVERED=0

# 检查必需 bins
echo -e "${BLUE}--- 必需依赖 (requires.bins) ---${NC}"
for bin in $(echo "${!SKILL_BINS[@]}" | tr ' ' '\n' | sort); do
    skill="${SKILL_BINS[$bin]}"
    os="${SKILL_OS[$bin]:-}"
    kind="${SKILL_INSTALL_KIND[$bin]:-unknown}"

    if [ -n "${DARWIN_ONLY[$bin]:-}" ] || [ "$os" = "darwin" ]; then
        ((DARWIN_COUNT++))
        echo -e "  ${YELLOW}[DARWIN]${NC} $bin (skill: $skill, kind: $kind) — macOS 专属，已跳过"
    elif [ -n "${BASE_TOOLS[$bin]:-}" ]; then
        ((BASE_COUNT++))
        echo -e "  ${GREEN}[BASE]${NC}   $bin (skill: $skill) — base 镜像已包含"
    elif [ -n "${INSTALLED_TOOLS[$bin]:-}" ]; then
        ((COVERED++))
        echo -e "  ${GREEN}[OK]${NC}     $bin (skill: $skill, kind: $kind)"
    else
        ((MISSING++))
        echo -e "  ${RED}[MISS]${NC}   $bin (skill: $skill, kind: $kind) — 未安装！"
    fi
done

# 检查 anyBins
echo ""
echo -e "${BLUE}--- 可选依赖 (requires.anyBins) ---${NC}"
for bin in $(echo "${!ANYBINS[@]}" | tr ' ' '\n' | sort); do
    skill="${ANYBINS[$bin]}"
    if [ -n "${INSTALLED_TOOLS[$bin]:-}" ] || [ -n "${BASE_TOOLS[$bin]:-}" ]; then
        ((ANY_COVERED++))
        echo -e "  ${GREEN}[OK]${NC}     $bin (skill: $skill)"
    else
        echo -e "  ${YELLOW}[SKIP]${NC}   $bin (skill: $skill) — anyBins，至少一个即可"
    fi
done

echo ""
echo -e "${CYAN}========== 统计摘要 ==========${NC}"
echo "  Dockerfile.full 已安装工具: ${#INSTALLED_TOOLS[@]}"
echo "  Skill 必需 bin 总数:        ${#SKILL_BINS[@]}"
echo "  已覆盖:                     $COVERED"
echo "  base 镜像已有:              $BASE_COUNT"
echo "  macOS 专属（已跳过）:       $DARWIN_COUNT"
echo -e "  ${RED}未安装:                     $MISSING${NC}"
echo "  anyBins 已覆盖:             $ANY_COVERED / ${#ANYBINS[@]}"
echo "=================================="

if [ "$MISSING" -gt 0 ]; then
    log_warn "发现 $MISSING 个未安装的必需工具，请检查是否需要补充到 Dockerfile.full"
    exit 1
else
    log_ok "所有 Linux 可用的必需工具均已覆盖！"
    exit 0
fi
