package ui

import (
	"fmt"
	"strings"
	"testing"

	"stream-deck-plus-emulator/internal/deck"
)

const testLayout = `layouts:
  - id: custom-plus
    name: Custom Plus
    source: {vendorId: 0x0fd9, productId: 0x0084}
    width: 8
    height: 3
    elements:
      - {type: key, count: 8, columns: 8, x: 0, y: 0, width: 1, height: 1}
      - {type: strip, x: 0, y: 1, width: 8, height: 1}
      - {type: dial, count: 4, x: 0, y: 2, width: 1, height: 1}
`

func TestDefaultLayouts(t *testing.T) {
	layouts, err := DefaultLayouts()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Layout{}
	for _, l := range layouts {
		byID[l.ID] = l
	}
	for _, m := range deck.Models() {
		if l, ok := byID[m.ID]; !ok || l.SourceID != m.ID {
			t.Errorf("missing stock view of %s", m.ID)
		}
	}
	l := byID["plus-xl-studio"]
	if l.SourceID != "plus-xl" {
		t.Fatalf("source: %q", l.SourceID)
	}
	var keys, dials []LayoutElement
	var strip LayoutElement
	for _, e := range l.Elements {
		switch e.Type {
		case "key":
			keys = append(keys, e)
		case "dial":
			dials = append(dials, e)
		case "strip":
			strip = e
		}
	}
	if len(keys) != 36 || len(dials) != 6 {
		t.Fatalf("keys %d dials %d", len(keys), len(dials))
	}
	for i, key := range keys {
		if key.Index != i || key.Y != float64(i/18)*1.24 || key.X < 1 || key.X >= strip.X+strip.Width {
			t.Errorf("key %d: %+v", i, key)
		}
	}
	if strip.Y <= keys[35].Y+keys[35].Height {
		t.Errorf("strip is not beneath both key rows")
	}
	for i, dial := range dials {
		if dial.Index != i || (i < 3 && dial.X >= strip.X) || (i >= 3 && dial.X <= strip.X+strip.Width) {
			t.Errorf("dial %d: %+v", i, dial)
		}
		if i%3 != 0 && dial.Y <= dials[i-1].Y {
			t.Errorf("dials not vertical: %+v", dials)
		}
	}
}

func TestParseLayouts(t *testing.T) {
	layouts, err := ParseLayouts(strings.NewReader(testLayout), deck.Models())
	if err != nil {
		t.Fatal(err)
	}
	l := layouts[0]
	if l.SourceID != "plus" || len(l.Elements) != 13 || l.Elements[7].Index != 7 || l.Elements[7].X != 7 {
		t.Errorf("expanded layout: %+v", l)
	}
	for name, text := range map[string]string{
		"unknown field":      strings.Replace(testLayout, "width: 8", "widht: 8", 1),
		"unknown source":     strings.Replace(testLayout, "0x0084", "0xffff", 1),
		"ambiguous source":   strings.Replace(testLayout, "0x0084", "0x00b9", 1),
		"missing source":     strings.Replace(testLayout, "vendorId: 0x0fd9, ", "", 1),
		"invalid id":         strings.Replace(testLayout, "custom-plus", "../bad", 1),
		"reserved id":        strings.Replace(testLayout, "custom-plus", "neo", 1),
		"empty name":         strings.Replace(testLayout, "name: Custom Plus", `name: ""`, 1),
		"missing control":    strings.Replace(testLayout, "count: 4", "count: 3", 1),
		"bad index":          strings.Replace(testLayout, "type: dial,", "type: dial, index: 4,", 1),
		"bad count":          strings.Replace(testLayout, "count: 4", "count: -1", 1),
		"zero count":         strings.Replace(testLayout, "count: 4", "count: 0", 1),
		"zero columns":       strings.Replace(testLayout, "columns: 8", "columns: 0", 1),
		"bad columns":        strings.Replace(testLayout, "columns: 8", "columns: -1", 1),
		"unknown element":    strings.Replace(testLayout, "type: strip", "type: screen", 1),
		"duplicate":          testLayout + "      - {type: dial, x: 6, y: 2, width: 1, height: 1}\n",
		"overlap":            strings.Replace(testLayout, "x: 0, y: 2", "x: 0, y: 1", 1),
		"outside":            strings.Replace(testLayout, "width: 8\n", "width: 7\n", 1),
		"non finite":         strings.Replace(testLayout, "width: 8\n", "width: .inf\n", 1),
		"negative gap":       strings.Replace(testLayout, "columns: 8,", "columns: 8, gapX: -1,", 1),
		"zero size":          strings.Replace(testLayout, "height: 3", "height: 0", 1),
		"duplicate id":       testLayout + strings.TrimPrefix(testLayout, "layouts:\n"),
		"multiple documents": testLayout + "---\n" + testLayout,
		"oversized":          testLayout + strings.Repeat(" ", 1<<20),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseLayouts(strings.NewReader(text), deck.Models()); err == nil {
				t.Fatal("invalid layout accepted")
			}
		})
	}
}

func TestMergeLayouts(t *testing.T) {
	base, err := DefaultLayouts()
	if err != nil {
		t.Fatal(err)
	}
	custom, err := ParseLayouts(strings.NewReader(testLayout), deck.Models())
	if err != nil {
		t.Fatal(err)
	}
	replacement := custom[0]
	replacement.ID = "plus"
	got := MergeLayouts(base, []Layout{replacement, custom[0]})
	if len(got) != len(base)+1 || got[0].Name != "Custom Plus" || got[len(got)-1].ID != "custom-plus" || base[0].Name == "Custom Plus" {
		t.Fatalf("merge changed base or lost layouts: %v", got)
	}
}

func TestLayoutAPIAndSharedDevice(t *testing.T) {
	r := newRig([]string{testHost})
	rec := r.do("GET", "/api/layouts", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"sourceId":"plus-xl"`) || !strings.Contains(rec.Body.String(), `"id":"plus-xl-studio"`) {
		t.Fatalf("layout API: %d %s", rec.Code, rec.Body)
	}
	if rec := r.do("GET", "/kiosk/plus-xl-studio", ""); rec.Code != 200 {
		t.Errorf("custom kiosk: %d", rec.Code)
	}
	// The layout is a view, not an extra USB device/API identity.
	if rec := r.do("POST", "/api/devices/plus-xl-studio/connect", ""); rec.Code != 404 {
		t.Errorf("layout unexpectedly created a device: %d", rec.Code)
	}
	for _, action := range []string{"connect", "disconnect"} {
		if rec := r.do("POST", fmt.Sprintf("/api/devices/plus-xl/%s", action), ""); rec.Code != 204 {
			t.Errorf("source %s: %d", action, rec.Code)
		}
	}
	if strings.Join(r.linker.calls, ",") != "connect plus-xl,disconnect plus-xl" {
		t.Errorf("source connection: %v", r.linker.calls)
	}
}
