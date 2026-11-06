package deck

import (
	"bytes"
	"testing"

	"stream-deck-plus-emulator/internal/usbip"
)

func TestModelFirmwareReports(t *testing.T) {
	for _, m := range Models() {
		t.Run(m.ID, func(t *testing.T) {
			d := New(m)
			for _, tc := range []struct {
				id      byte
				version string
			}{
				{featureFirmwareLD, "1.00.003"},
				{featureFirmwareAP2, "3.01.005"},
				{featureFirmwareAP1, "1.01.000"},
			} {
				if m.ID == "galleon-100" && tc.id == featureFirmwareAP2 {
					tc.version = "3.06.006"
				}
				want := make([]byte, featureReportSize)
				want[0], want[offFirmwareLength] = tc.id, firmwareLength
				copy(want[offFirmwareVersion:], tc.version)
				setup := usbip.Setup{
					RequestType: reqTypeHIDIn,
					Request:     hidGetReport,
					Value:       reportTypeFeature<<8 | uint16(tc.id),
					Length:      featureReportSize,
				}
				for _, state := range []string{"initial", "reset", "reattached"} {
					switch state {
					case "reset":
						d.Reset()
					case "reattached":
						d.SetAttached(false)
						d.SetAttached(true)
					}
					got, err := d.Control(setup, nil)
					if err != nil || !bytes.Equal(got, want) {
						t.Errorf("feature %#02x (%s): got %x, err %v; want %x", tc.id, state, got, err, want)
					}
				}
			}
		})
	}
}
