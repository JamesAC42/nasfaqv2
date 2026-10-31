package talents

import (
	"reflect"
	"testing"
)

var testRoster = []Talent{
	{Name: "Usada Pekora", Symbol: "PEK"},
	{Name: "Houshou Marine", Symbol: "MAR"},
	{Name: "Shirogane Noel", Symbol: "NOE"},
	{Name: "Ninomae Ina'nis", Symbol: "INA"},
	{Name: "Watson Amelia", Symbol: "AME"},
	{Name: "Koseki Bijou", Symbol: "BIJ"},
	{Name: "Hiodoshi Ao", Symbol: "HIO"},
	{Name: "FuwaMoco Abyssgard", Symbol: "BYS"},
	{Name: "Tokino Sora", Symbol: "SRA"},
	{Name: "Hakos Baelz", Symbol: "BLZ"},
	{Name: "Newly Debuted", Symbol: ""},
}

func TestAliasTableLoads(t *testing.T) {
	if len(aliasTable) < 50 {
		t.Fatalf("alias table has %d talents, want the whole roster", len(aliasTable))
	}
	if len(aliasTable["PEK"].Strong) == 0 {
		t.Fatal("PEK has no strong aliases")
	}
}

func TestMatch(t *testing.T) {
	m := NewMatcher(testRoster)
	cases := []struct {
		name string
		text string
		want []string
	}{
		{"full names in order", "Houshou Marine and Usada Pekora announce a collab", []string{"Houshou Marine", "Usada Pekora"}},
		{"first names and nicknames", "Senchou and Peko-chan? No: Pekora and Biboo", []string{"Houshou Marine", "Usada Pekora", "Koseki Bijou"}},
		{"names nobody", "Shattered Legends is confirmed as a Tabletop RPG project with Matt Mercer serving as GM for 4 Hololive talents.", nil},
		{"a strong alias is any case", "PEKORA hits 3 million", []string{"Usada Pekora"}},
		{"a weak alias only as written", "the marine biology stream and an ao dai outfit", nil},
		{"a weak alias capitalised", "Marine and Ao sing together", []string{"Houshou Marine", "Hiodoshi Ao"}},
		{"not inside another word", "Pekoraaa and Inanimate objects", nil},
		{"curly apostrophes", "Ninomae Ina’nis draws a new outfit", []string{"Ninomae Ina'nis"}},
		{"a duo by either name", "Mococo's birthday", []string{"FuwaMoco Abyssgard"}},
		{"spaces, dashes or nothing", "Sorachan and Sora-chan", []string{"Tokino Sora"}},
		{"japanese anywhere", "ぺこらの新衣装", []string{"Usada Pekora"}},
		{"no symbol: name and last part", "Debuted streams today", []string{"Newly Debuted"}},
		{"the same talent twice counts once", "Bae! Hakos Baelz and Baelz again", []string{"Hakos Baelz"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := m.Match(tc.text)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("Match(%q) = %v, want %v", tc.text, got, tc.want)
			}
		})
	}
}

func TestNilMatcher(t *testing.T) {
	var m *Matcher
	if got := m.Match("Usada Pekora"); got != nil {
		t.Fatalf("nil matcher matched %v", got)
	}
}
