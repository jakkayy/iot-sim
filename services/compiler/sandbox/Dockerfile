# Sandbox image: clang + the Arduino shim. Build from the repository root:
#   docker build -f services/compiler/sandbox/Dockerfile -t esp32-sim-sandbox:dev .
# One throwaway container per compile, run with no network and a read-only root
# (see DockerRunner in services/compiler/runner.go).
FROM silkeh/clang:19

COPY arduino-shim /shim
RUN chmod -R a+rX /shim \
 && /shim/build/build-lib.sh \
 # The version changes whenever any shim file changes, which invalidates cached builds.
 && (cd /shim && find . -type f ! -name VERSION ! -path './lib/*' | sort | xargs sha256sum | sha256sum | cut -c1-16 > VERSION) \
 && chmod -R a+rX /shim

USER 65534:65534
WORKDIR /tmp
