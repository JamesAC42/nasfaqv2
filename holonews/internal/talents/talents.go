// Package talents finds the hololive talents a piece of text names: by full name, first name or a
// known nickname ("Senchou", "Biboo"). It is the Go side of api/src/services/talents.js and matches
// the same way:
//
//   - strong aliases match whatever their case, as whole words;
//   - weak ones (short or everyday words: "Ao", "Ame", "Marine") only as written, capitalised;
//   - Japanese ones anywhere, since Japanese has no spaces between words;
//   - the longest alias wins, and each part of the text counts once ("Usada Pekora" is one mention).
//
// aliases.json is that file's ALIASES table, written by api/scripts/export-talent-aliases.js;
// api/test/holonews-thumbnails.test.js fails when the two differ. Unlike the API, text isn't
// NFKC-normalised here, so full-width letters don't match.
package talents

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

//go:embed aliases.json
var aliasesJSON []byte

type aliasEntry struct {
	Strong []string `json:"strong"`
	Weak   []string `json:"weak"`
}

// aliasTable is keyed by stock symbol (PEK, MAR, ...).
var aliasTable = mustLoadAliases(aliasesJSON)

func mustLoadAliases(data []byte) map[string]aliasEntry {
	var out map[string]aliasEntry
	if err := json.Unmarshal(data, &out); err != nil {
		panic("talents: aliases.json: " + err.Error())
	}
	return out
}

// Talent is one talent the matcher can find: the channel's English name, and the stock symbol the
// alias table is keyed by (empty when the channel has no stock; its aliases then come from its name).
type Talent struct {
	Name   string
	Symbol string
}

type rule struct {
	name    string
	alias   string
	pattern *regexp.Regexp
}

// Matcher finds the talents a text names. Build it once per roster with NewMatcher.
type Matcher struct {
	rules []rule
}

// aliasesFor gives a talent's aliases: from the table, or their full name and last name part.
func aliasesFor(symbol, name string) aliasEntry {
	if entry, ok := aliasTable[strings.ToUpper(strings.TrimSpace(symbol))]; ok {
		return entry
	}
	full := strings.Join(strings.Fields(name), " ")
	if full == "" {
		return aliasEntry{}
	}
	var parts []string
	for _, part := range strings.Fields(full) {
		if utf8.RuneCountInString(part) >= 4 {
			parts = append(parts, part)
		}
	}
	strong := []string{full}
	if len(parts) > 0 {
		strong = append(strong, parts[len(parts)-1])
	}
	return aliasEntry{Strong: strong}
}

func normalize(text string) string {
	return strings.NewReplacer("’", "'", "`", "'").Replace(text)
}

func isCJK(text string) bool {
	for _, r := range text {
		if (r >= 0x3040 && r <= 0x30FF) || (r >= 0x3400 && r <= 0x9FFF) {
			return true
		}
	}
	return false
}

// aliasPattern matches an alias with its text in group 1. Spaces in the alias also match "_", "-"
// or nothing ("Sora chan", "Sora-chan", "Sorachan"); a letter or digit may not continue the word on
// either side.
func aliasPattern(alias string, caseSensitive bool) *regexp.Regexp {
	clean := normalize(alias)
	words := strings.Fields(clean)
	if len(words) == 0 {
		return nil
	}
	for i, word := range words {
		words[i] = regexp.QuoteMeta(word)
	}
	body := strings.Join(words, `[\s_-]*`)
	if isCJK(clean) {
		return regexp.MustCompile("(" + body + ")")
	}
	flags := ""
	if !caseSensitive {
		flags = "(?i)"
	}
	return regexp.MustCompile(flags + `(?:^|[^\p{L}\p{N}])(` + body + `)(?:[^\p{L}\p{N}]|$)`)
}

// NewMatcher builds a matcher over the listed talents.
func NewMatcher(roster []Talent) *Matcher {
	m := &Matcher{}
	for _, talent := range roster {
		name := strings.TrimSpace(talent.Name)
		if name == "" {
			continue
		}
		entry := aliasesFor(talent.Symbol, name)
		for _, alias := range entry.Strong {
			if pattern := aliasPattern(alias, false); pattern != nil {
				m.rules = append(m.rules, rule{name: name, alias: alias, pattern: pattern})
			}
		}
		for _, alias := range entry.Weak {
			if pattern := aliasPattern(alias, true); pattern != nil {
				m.rules = append(m.rules, rule{name: name, alias: alias, pattern: pattern})
			}
		}
	}
	sort.SliceStable(m.rules, func(i, j int) bool {
		return utf8.RuneCountInString(m.rules[i].alias) > utf8.RuneCountInString(m.rules[j].alias)
	})
	return m
}

// Match gives the names of the talents the text names, in the order it first names them.
func (m *Matcher) Match(text string) []string {
	if m == nil {
		return nil
	}
	source := normalize(text)
	first := map[string]int{}
	for _, r := range m.rules {
		for {
			loc := r.pattern.FindStringSubmatchIndex(source)
			if loc == nil || loc[2] < 0 {
				break
			}
			start, end := loc[2], loc[3]
			if at, ok := first[r.name]; !ok || start < at {
				first[r.name] = start
			}
			// Blank the mention out so a shorter alias can't count it again.
			source = source[:start] + strings.Repeat(" ", end-start) + source[end:]
		}
	}
	names := make([]string, 0, len(first))
	for name := range first {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		if first[names[i]] != first[names[j]] {
			return first[names[i]] < first[names[j]]
		}
		return names[i] < names[j]
	})
	return names
}
