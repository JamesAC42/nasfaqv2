FROM golang:1.25-alpine AS build
WORKDIR /src
ENV GOFLAGS=-buildvcs=false
COPY ytscraper/go.mod ytscraper/go.sum ./
RUN go mod download
COPY ytscraper/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/ytscraper ./cmd/ytscraper

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
RUN adduser -D -H -u 10001 appuser
USER appuser
COPY --from=build /out/ytscraper /usr/local/bin/ytscraper
CMD ["ytscraper"]
