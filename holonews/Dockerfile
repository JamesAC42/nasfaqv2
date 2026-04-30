FROM golang:1.25-alpine AS build
WORKDIR /src
ENV GOFLAGS=-buildvcs=false
COPY holonews/go.mod holonews/go.sum ./
RUN go mod download
COPY holonews/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/holonews ./cmd/holonews

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
RUN adduser -D -H -u 10001 appuser
USER appuser
COPY --from=build /out/holonews /usr/local/bin/holonews
CMD ["holonews"]
