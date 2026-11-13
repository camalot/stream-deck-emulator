package ui

import (
	_ "embed"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"

	"stream-deck-plus-emulator/internal/deck"
)

//go:embed layouts.yaml
var bundledLayouts string

type LayoutSource struct {
	VendorID  uint16 `yaml:"vendorId" json:"vendorId"`
	ProductID uint16 `yaml:"productId" json:"productId"`
	ModelID   string `yaml:"modelId,omitempty" json:"modelId,omitempty"`
}

// LayoutElement positions a control in canvas units. Count and Columns expand
// consecutive source indices into a grid when reading YAML.
type LayoutElement struct {
	Type    string  `yaml:"type" json:"type"`
	Index   int     `yaml:"index,omitempty" json:"index"`
	X       float64 `yaml:"x" json:"x"`
	Y       float64 `yaml:"y" json:"y"`
	Width   float64 `yaml:"width" json:"width"`
	Height  float64 `yaml:"height" json:"height"`
	Count   *int    `yaml:"count,omitempty" json:"-"`
	Columns *int    `yaml:"columns,omitempty" json:"-"`
	GapX    float64 `yaml:"gapX,omitempty" json:"-"`
	GapY    float64 `yaml:"gapY,omitempty" json:"-"`
}

type Layout struct {
	ID       string          `yaml:"id" json:"id"`
	Name     string          `yaml:"name" json:"name"`
	Source   LayoutSource    `yaml:"source" json:"source"`
	SourceID string          `yaml:"-" json:"sourceId"`
	Width    float64         `yaml:"width" json:"width"`
	Height   float64         `yaml:"height" json:"height"`
	Elements []LayoutElement `yaml:"elements" json:"elements"`
}

var layoutID = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// DefaultLayouts returns the stock views and the bundled + XL studio example.
func DefaultLayouts() ([]Layout, error) {
	return ParseLayouts(strings.NewReader(bundledLayouts), deck.Models())
}

// ParseLayouts rejects unknown devices, incomplete mappings and unsafe geometry
// before any configuration reaches the browser. It never alters a USB model.
func ParseLayouts(r io.Reader, models []deck.Model) ([]Layout, error) {
	var config struct {
		Layouts []Layout `yaml:"layouts"`
	}
	data, err := io.ReadAll(io.LimitReader(r, (1<<20)+1))
	if err != nil {
		return nil, fmt.Errorf("layouts: %w", err)
	}
	if len(data) > 1<<20 {
		return nil, fmt.Errorf("layouts: file exceeds 1 MiB")
	}
	decoder := yaml.NewDecoder(strings.NewReader(string(data)))
	decoder.KnownFields(true)
	if err := decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("layouts: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("layouts: expected one YAML document, got %v", err)
	}
	if len(config.Layouts) == 0 {
		return nil, fmt.Errorf("layouts: no layouts defined")
	}
	seen := map[string]bool{}
	for i := range config.Layouts {
		l := &config.Layouts[i]
		if !layoutID.MatchString(l.ID) || strings.TrimSpace(l.Name) == "" || seen[l.ID] {
			return nil, fmt.Errorf("layouts: invalid or duplicate id/name %q", l.ID)
		}
		seen[l.ID] = true
		m, err := sourceModel(l.Source, models)
		if err != nil {
			return nil, fmt.Errorf("layout %q: %w", l.ID, err)
		}
		if _, ok := deck.ModelByID(l.ID); ok && l.ID != m.ID {
			return nil, fmt.Errorf("layout %q: id is reserved for another source device", l.ID)
		}
		l.SourceID = m.ID
		if err := expandLayout(l, m); err != nil {
			return nil, fmt.Errorf("layout %q: %w", l.ID, err)
		}
	}
	return config.Layouts, nil
}

func sourceModel(source LayoutSource, models []deck.Model) (deck.Model, error) {
	var matches []deck.Model
	for _, m := range models {
		vid := m.VendorID
		if vid == 0 {
			vid = 0x0fd9
		}
		if vid == source.VendorID && m.ProductID == source.ProductID && (source.ModelID == "" || source.ModelID == m.ID) {
			matches = append(matches, m)
		}
	}
	if len(matches) != 1 {
		return deck.Model{}, fmt.Errorf("source %04x:%04x modelId %q resolves to %d devices; specify a known, unambiguous source", source.VendorID, source.ProductID, source.ModelID, len(matches))
	}
	return matches[0], nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func expandLayout(l *Layout, m deck.Model) error {
	if !finite(l.Width) || !finite(l.Height) || l.Width <= 0 || l.Height <= 0 || l.Width > 10000 || l.Height > 10000 {
		return fmt.Errorf("canvas dimensions must be positive and at most 10000")
	}
	counts := map[string]int{"key": m.Keys(), "dial": m.Dials, "touchKey": m.TouchKeys, "strip": 0, "screen": 0}
	if !m.Strip.Empty() {
		counts["strip"] = 1
	}
	if !m.Screen.Empty() {
		counts["screen"] = 1
	}
	seen := map[string]map[int]bool{}
	var elements []LayoutElement
	for _, e := range l.Elements {
		total, ok := counts[e.Type]
		if !ok {
			return fmt.Errorf("unknown element type %q", e.Type)
		}
		count := 1
		if e.Count != nil {
			count = *e.Count
		}
		cols := count
		if e.Columns != nil {
			cols = *e.Columns
		}
		if count < 1 || cols < 1 || cols > count || e.Index < 0 || count > total || e.Index > total-count {
			return fmt.Errorf("%s: invalid source indices/count/columns", e.Type)
		}
		if !finite(e.X) || !finite(e.Y) || !finite(e.Width) || !finite(e.Height) || !finite(e.GapX) || !finite(e.GapY) ||
			e.X < 0 || e.Y < 0 || e.Width <= 0 || e.Height <= 0 || e.GapX < 0 || e.GapY < 0 {
			return fmt.Errorf("%s: invalid geometry", e.Type)
		}
		if seen[e.Type] == nil {
			seen[e.Type] = map[int]bool{}
		}
		for i := range count {
			item := LayoutElement{
				Type: e.Type, Index: e.Index + i, Width: e.Width, Height: e.Height,
				X: e.X + float64(i%cols)*(e.Width+e.GapX),
				Y: e.Y + float64(i/cols)*(e.Height+e.GapY),
			}
			if item.X+item.Width > l.Width+1e-9 || item.Y+item.Height > l.Height+1e-9 {
				return fmt.Errorf("%s %d: outside canvas", item.Type, item.Index)
			}
			if seen[item.Type][item.Index] {
				return fmt.Errorf("%s %d: duplicate mapping", item.Type, item.Index)
			}
			for _, other := range elements {
				if item.X < other.X+other.Width-1e-9 && other.X < item.X+item.Width-1e-9 &&
					item.Y < other.Y+other.Height-1e-9 && other.Y < item.Y+item.Height-1e-9 {
					return fmt.Errorf("%s %d overlaps %s %d", item.Type, item.Index, other.Type, other.Index)
				}
			}
			seen[item.Type][item.Index] = true
			elements = append(elements, item)
		}
	}
	for typ, count := range counts {
		if len(seen[typ]) != count {
			return fmt.Errorf("%s: mapped %d of %d controls", typ, len(seen[typ]), count)
		}
	}
	l.Elements = elements
	return nil
}

// MergeLayouts allows an external file to replace a bundled view by ID or add
// new views, while keeping every stock device accessible.
func MergeLayouts(base, custom []Layout) []Layout {
	result := append([]Layout(nil), base...)
	for _, l := range custom {
		found := false
		for i := range result {
			if result[i].ID == l.ID {
				result[i] = l
				found = true
				break
			}
		}
		if !found {
			result = append(result, l)
		}
	}
	return result
}
