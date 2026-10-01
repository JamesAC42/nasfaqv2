package main

import "testing"

func TestExtractHeadlinesPrefersLaterGreentextRoundup(t *testing.T) {
	posts := []post{
		{
			No: 1,
			Com: "HoloPro<br>" +
				"Old OP item<br>" +
				"Other section:",
		},
		{
			No:  2,
			Com: "discussion only",
		},
		{
			No: 3,
			Com: "Hololive<br>" +
				"&gt;First actual item<br>" +
				"&gt;Second actual item<br>" +
				"closing note",
		},
	}

	extraction, err := extractHeadlines(posts, 10)
	if err != nil {
		t.Fatalf("extractHeadlines returned error: %v", err)
	}
	if extraction.PostID != 3 {
		t.Fatalf("PostID = %d, want 3", extraction.PostID)
	}
	if extraction.SectionKey != hololiveSectionKey {
		t.Fatalf("SectionKey = %q, want %q", extraction.SectionKey, hololiveSectionKey)
	}
	want := []string{"First actual item", "Second actual item"}
	if len(extraction.Headlines) != len(want) {
		t.Fatalf("Headlines len = %d, want %d: %#v", len(extraction.Headlines), len(want), extraction.Headlines)
	}
	for i := range want {
		if extraction.Headlines[i] != want[i] {
			t.Fatalf("Headlines[%d] = %q, want %q", i, extraction.Headlines[i], want[i])
		}
	}
}

func TestExtractHeadlinesSkipsQuoteReferencesInGreentextRoundup(t *testing.T) {
	headlines := extractHeadlinesFromPost(post{
		No: 10,
		Com: "HoloPro:<br>" +
			"&gt;News item<br>" +
			"&gt;&gt;123456<br>" +
			"&gt;Ignored after quote ref",
	})

	if len(headlines) != 1 {
		t.Fatalf("Headlines len = %d, want 1: %#v", len(headlines), headlines)
	}
	if headlines[0] != "News item" {
		t.Fatalf("Headlines[0] = %q, want News item", headlines[0])
	}
}

func TestStoredPayloadMatchesSourcePost(t *testing.T) {
	payload := storedPayload{
		ThreadID:   100,
		SourcePost: 101,
		Items:      []storedHeadline{{Headline: "Already generated"}},
	}

	tests := []struct {
		name         string
		ok           bool
		threadID     int64
		sourcePostID int64
		want         bool
	}{
		{name: "same source post", ok: true, threadID: 100, sourcePostID: 101, want: true},
		{name: "different thread", ok: true, threadID: 200, sourcePostID: 101, want: false},
		{name: "different source post", ok: true, threadID: 100, sourcePostID: 102, want: false},
		{name: "no stored payload", ok: false, threadID: 100, sourcePostID: 101, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := storedPayloadMatchesSourcePost(payload, tt.ok, tt.threadID, tt.sourcePostID)
			if got != tt.want {
				t.Fatalf("storedPayloadMatchesSourcePost() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCanonicalHeadlineKey(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "trims and lowercases", in: "  Same Story  ", want: "same story"},
		{name: "collapses whitespace", in: "Same\tStory\nAgain", want: "same story again"},
		{name: "empty", in: " \t ", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canonicalHeadlineKey(tt.in); got != tt.want {
				t.Fatalf("canonicalHeadlineKey(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestReferenceImagesForChannelNames(t *testing.T) {
	cases := map[string][]string{
		"Usada Pekora":       {"usada-pekora"},
		"La+ Darknesss":      {"la-darknesss"},
		"Ninomae Ina’nis":    {"ninomae-inanis"},
		"Robocosan":          {"roboco-san"},
		"FuwaMoco Abyssgard": {"fuwawa-abyssgard", "mococo-abyssgard"},
		"  Hakos   Baelz ":   {"hakos-baelz"},
	}
	for name, want := range cases {
		got := referenceImagesFor(name).Slugs
		if len(got) != len(want) {
			t.Fatalf("%q: got %v, want %v", name, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%q: got %v, want %v", name, got, want)
			}
		}
	}
	if referenceImagesFor("FuwaMoco Abyssgard").Note == "" {
		t.Fatal("the duo needs a note for the image prompt")
	}
}
