FROM eclipse-temurin:21-jre

ARG GHIDRA_VERSION=12.0.3
ARG GHIDRA_DATE=20260210

# Download and extract Ghidra
RUN apt-get update && apt-get install -y wget unzip && \
    wget -q "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_DATE}.zip" \
         -O /tmp/ghidra.zip && \
    unzip -q /tmp/ghidra.zip -d /opt && \
    mv /opt/ghidra_${GHIDRA_VERSION}_PUBLIC /opt/ghidra && \
    rm /tmp/ghidra.zip && \
    rm -rf /var/lib/apt/lists/*

# Bundle major-language Ghidra extensions. URLs and SHA256 are pinned to a
# release verified against the Ghidra version above. Override via --build-arg
# when bumping Ghidra. Set INSTALL_LANG_EXTENSIONS=false to skip entirely.
ARG INSTALL_LANG_EXTENSIONS=true

# GolangAnalyzerExtension 1.3.0 / Ghidra 12.0.3 — Go binary symbol/type recovery
ARG EXT_GOLANG_URL="https://github.com/mooncat-greenpy/Ghidra_GolangAnalyzerExtension/releases/download/1.3.0/ghidra_12.0.3_PUBLIC_20260316_GolangAnalyzerExtension.zip"
ARG EXT_GOLANG_SHA256="9d525cc486a36429afbc9418f0bab897131029c09f85558129750629491a500d"

# CERTCC Kaiju 260309 / Ghidra 12.0.3 — C++ OOAnalyzer, function fingerprinting
ARG EXT_KAIJU_URL="https://github.com/CERTCC/kaiju/releases/download/260309/ghidra_12.0.3_PUBLIC_20260309_kaiju.zip"
ARG EXT_KAIJU_SHA256="d01c1718fef4b88a36a0dbf5117a6bc7bdaa27f2d6f08671552c7cd4ab30b184"

# Optional slots for languages without a maintained Ghidra-12.0.3 extension
# zip (Rust/Swift/Kotlin DEX rely on Ghidra's built-in demanglers and DEX
# loader). Supply URL+SHA256 via --build-arg if a suitable release appears.
ARG EXT_RUST_URL=""
ARG EXT_RUST_SHA256=""
ARG EXT_SWIFT_URL=""
ARG EXT_SWIFT_SHA256=""
ARG EXT_DEX_URL=""
ARG EXT_DEX_SHA256=""

RUN if [ "$INSTALL_LANG_EXTENSIONS" = "true" ]; then \
        set -e; mkdir -p /tmp/ext /opt/ghidra/Ghidra/Extensions; \
        for spec in \
            "golang|${EXT_GOLANG_URL}|${EXT_GOLANG_SHA256}" \
            "kaiju|${EXT_KAIJU_URL}|${EXT_KAIJU_SHA256}" \
            "rust|${EXT_RUST_URL}|${EXT_RUST_SHA256}" \
            "swift|${EXT_SWIFT_URL}|${EXT_SWIFT_SHA256}" \
            "dex|${EXT_DEX_URL}|${EXT_DEX_SHA256}"; do \
            name=$(echo "$spec" | cut -d'|' -f1); \
            url=$(echo  "$spec" | cut -d'|' -f2); \
            sha=$(echo  "$spec" | cut -d'|' -f3); \
            if [ -z "$url" ]; then echo "ext: skip $name (no URL)"; continue; fi; \
            if [ -z "$sha" ]; then echo "ext: $name has URL but no SHA256, refusing" >&2; exit 1; fi; \
            echo "ext: fetching $name"; \
            wget -q "$url" -O /tmp/ext/$name.zip; \
            echo "$sha  /tmp/ext/$name.zip" | sha256sum -c -; \
            unzip -qo /tmp/ext/$name.zip -d /opt/ghidra/Ghidra/Extensions/; \
        done; \
        rm -rf /tmp/ext; \
    fi

# Drop wget/unzip after Ghidra + extensions are staged.
RUN apt-get remove -y wget unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy pre-built JAR
COPY docker/ghidra-agent-mcp.jar /app/ghidra-agent-mcp.jar

# Copy entrypoint and extension installer
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/install-extensions.sh /app/install-extensions.sh
RUN chmod +x /app/entrypoint.sh /app/install-extensions.sh

# Create directories
RUN mkdir -p /binaries /data

ENV GHIDRA_INSTALL_DIR=/opt/ghidra
ENV GHIDRA_MCP_PORT=8089
ENV BIND_ADDRESS=0.0.0.0
ENV AUTO_IMPORT=false

VOLUME ["/binaries", "/data"]
EXPOSE 8089

ENTRYPOINT ["/app/entrypoint.sh"]
