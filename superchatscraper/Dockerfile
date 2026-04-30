FROM golang:1.25-alpine AS build
WORKDIR /src
ENV GOFLAGS=-buildvcs=false
COPY superchatscraper/go.mod superchatscraper/go.sum ./
RUN go mod download
COPY superchatscraper/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/superchatscraper ./cmd/superchatscraper

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
RUN adduser -D -H -u 10001 appuser
USER appuser
COPY --from=build /out/superchatscraper /usr/local/bin/superchatscraper
CMD ["superchatscraper"]
