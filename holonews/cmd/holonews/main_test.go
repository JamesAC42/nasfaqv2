package main

import (
	"reflect"
	"strings"
	"testing"

	"github.com/JamesAC42/nasfaqv2/holonews/internal/talents"
)

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

var thumbnailRoster = []talents.Talent{
	{Name: "Usada Pekora", Symbol: "PEK"},
	{Name: "Houshou Marine", Symbol: "MAR"},
	{Name: "Shirogane Noel", Symbol: "NOE"},
	{Name: "Mori Calliope", Symbol: "CLI"},
	{Name: "Gawr Gura", Symbol: "GUR"},
	{Name: "Yukihana Lamy", Symbol: "LAM"},
	{Name: "Omaru Polka", Symbol: "PLK"},
	{Name: "FuwaMoco Abyssgard", Symbol: "BYS"},
}

// The thumbnail only shows talents the headline names, whatever the model says.
func TestSelectTalents(t *testing.T) {
	matcher := talents.NewMatcher(thumbnailRoster)
	cases := []struct {
		name      string
		headline  string
		confirmed []string
		want      []string
	}{
		{
			name:      "a headline that names nobody gets nobody, however many it counts",
			headline:  "Shattered Legends is confirmed as a Tabletop RPG project with Matt Mercer serving as GM for 4 Hololive talents.",
			confirmed: []string{"Usada Pekora", "Houshou Marine", "Mori Calliope", "Gawr Gura"},
			want:      nil,
		},
		{
			name:      "named talents, and only those",
			headline:  "Pekora and Marine announce a joint 3D live",
			confirmed: []string{"Usada Pekora", "Houshou Marine", "Shirogane Noel"},
			want:      []string{"Usada Pekora", "Houshou Marine"},
		},
		{
			name:      "nicknames count as naming",
			headline:  "Senchou visits Peko-land",
			confirmed: []string{"houshou marine", "Usada Pekora"},
			want:      []string{"Houshou Marine", "Usada Pekora"},
		},
		{
			name:      "the model can drop a name that means something else",
			headline:  "Lamy shows off a polka dot dress",
			confirmed: []string{"Yukihana Lamy"},
			want:      []string{"Yukihana Lamy"},
		},
		{
			name:      "the model can't add anyone",
			headline:  "Mococo's birthday stream",
			confirmed: []string{"FuwaMoco Abyssgard", "Gawr Gura"},
			want:      []string{"FuwaMoco Abyssgard"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := selectTalents(matcher.Match(tc.headline), tc.confirmed)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("selectTalents(%q) = %v, want %v", tc.headline, got, tc.want)
			}
		})
	}
}

func TestPlanThumbnail(t *testing.T) {
	t.Run("no talent and nothing to picture: no thumbnail", func(t *testing.T) {
		plan := planThumbnail(nil, promptResult{Skip: true})
		if plan.Draw || plan.Reason == "" {
			t.Fatalf("plan = %+v, want no thumbnail with a reason", plan)
		}
	})
	t.Run("a skip with talents named still draws them", func(t *testing.T) {
		plan := planThumbnail([]string{"Usada Pekora"}, promptResult{ImagePrompt: "Pekora with a carrot", Skip: true})
		if !plan.Draw {
			t.Fatalf("plan = %+v, want a thumbnail", plan)
		}
	})
	t.Run("an empty prompt: no thumbnail", func(t *testing.T) {
		if plan := planThumbnail([]string{"Usada Pekora"}, promptResult{ImagePrompt: "  "}); plan.Draw {
			t.Fatalf("plan = %+v, want no thumbnail", plan)
		}
	})
	t.Run("no talent but a clear scene: nobody in it", func(t *testing.T) {
		plan := planThumbnail(nil, promptResult{ImagePrompt: "a tabletop RPG table with dice"})
		if !plan.Draw {
			t.Fatalf("plan = %+v, want a thumbnail", plan)
		}
		if !strings.Contains(plan.Prompt, "Draw no people and no characters") {
			t.Fatalf("prompt %q should forbid people", plan.Prompt)
		}
		if strings.Contains(plan.Prompt, "reference images") {
			t.Fatalf("prompt %q shouldn't mention reference images", plan.Prompt)
		}
	})
	t.Run("named talents: exactly those", func(t *testing.T) {
		plan := planThumbnail([]string{"Usada Pekora", "FuwaMoco Abyssgard"}, promptResult{ImagePrompt: "a collab"})
		want := "Draw exactly 2 characters: Usada Pekora, FuwaMoco Abyssgard (the twins Fuwawa and Mococo Abyssgard, one image each)."
		if !plan.Draw || !strings.Contains(plan.Prompt, want) || !strings.Contains(plan.Prompt, "Add no other characters") {
			t.Fatalf("prompt %q, want it to contain %q and forbid anyone else", plan.Prompt, want)
		}
	})
}

func TestThumbnailCastRules(t *testing.T) {
	if rules := thumbnailCastRules(nil); !strings.Contains(rules, "NO people") || !strings.Contains(rules, `"skip":true`) {
		t.Fatalf("cast rules without talents = %q", rules)
	}
	if rules := thumbnailCastRules([]string{"Usada Pekora"}); !strings.Contains(rules, "Draw exactly these hololive talents and nobody else: Usada Pekora.") {
		t.Fatalf("cast rules with a talent = %q", rules)
	}
}
