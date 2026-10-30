package youtube

import (
	"fmt"
	"testing"
)

func TestAPIErrorReasons(t *testing.T) {
	quota := newAPIError(403, []byte(`{"error":{"code":403,"message":"The request cannot be completed because you have exceeded your quota.","errors":[{"message":"The request cannot be completed because you have exceeded your quota.","domain":"youtube.quota","reason":"quotaExceeded"}]}}`))
	if !IsQuotaExceeded(quota) {
		t.Errorf("quotaExceeded not recognised: %v", quota.Reasons)
	}
	if !IsQuotaExceeded(fmt.Errorf("channel batch: %w", quota)) {
		t.Error("a wrapped quota error is still a quota error")
	}
	if want := "youtube api http 403: {"; quota.Error()[:len(want)] != want {
		t.Errorf("message changed: %q", quota.Error())
	}

	notFound := newAPIError(404, []byte(`{"error":{"code":404,"errors":[{"domain":"youtube.playlistItem","reason":"playlistNotFound"}]}}`))
	if IsQuotaExceeded(notFound) {
		t.Error("playlistNotFound isn't a quota error")
	}
	if !isPlaylistNotFoundError(notFound) {
		t.Error("playlistNotFound is still recognised from the message")
	}

	if IsQuotaExceeded(newAPIError(500, []byte("backend error"))) {
		t.Error("a body that isn't JSON has no reasons")
	}
	if IsQuotaExceeded(fmt.Errorf("http request: timeout")) {
		t.Error("a network error isn't a quota error")
	}
}
