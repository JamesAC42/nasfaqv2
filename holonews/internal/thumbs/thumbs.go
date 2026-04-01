package thumbs

import (
	"bytes"
	"fmt"
	"image"
	stddraw "image/draw"
	"image/jpeg"
	"path"
	"strings"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
)

const (
	ObjectPrefix = "thumbnail-"
	DefaultSize  = 480
)

func VariantKey(key string) string {
	clean := strings.TrimSpace(key)
	if clean == "" {
		return ObjectPrefix
	}
	dir, file := path.Split(clean)
	if dir == "" {
		return ObjectPrefix + file
	}
	return path.Join(strings.TrimSuffix(dir, "/"), ObjectPrefix+file)
}

func IsVariantKey(key string) bool {
	_, file := path.Split(strings.TrimSpace(key))
	return strings.HasPrefix(file, ObjectPrefix)
}

func SquareJPEG(data []byte, size int) ([]byte, string, error) {
	if size <= 0 {
		size = DefaultSize
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("decode image: %w", err)
	}

	bounds := src.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return nil, "", fmt.Errorf("invalid image bounds %v", bounds)
	}

	crop := centeredSquare(bounds)
	square := image.NewRGBA(image.Rect(0, 0, crop.Dx(), crop.Dy()))
	stddraw.Draw(square, square.Bounds(), src, crop.Min, stddraw.Src)

	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), square, square.Bounds(), xdraw.Over, nil)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 88}); err != nil {
		return nil, "", fmt.Errorf("encode jpeg: %w", err)
	}
	return out.Bytes(), "image/jpeg", nil
}

func centeredSquare(bounds image.Rectangle) image.Rectangle {
	width := bounds.Dx()
	height := bounds.Dy()
	if width == height {
		return bounds
	}
	if width > height {
		offset := (width - height) / 2
		return image.Rect(bounds.Min.X+offset, bounds.Min.Y, bounds.Min.X+offset+height, bounds.Max.Y)
	}
	offset := (height - width) / 2
	return image.Rect(bounds.Min.X, bounds.Min.Y+offset, bounds.Max.X, bounds.Min.Y+offset+width)
}
