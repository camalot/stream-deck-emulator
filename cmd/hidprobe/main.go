//go:build windows

// hidprobe dumps the HID capabilities and feature reports of a connected
// Elgato device. It only reads; nothing is written to the device.
package main

import (
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	hid                    = syscall.NewLazyDLL("hid.dll")
	procGetPreparsedData   = hid.NewProc("HidD_GetPreparsedData")
	procFreePreparsedData  = hid.NewProc("HidD_FreePreparsedData")
	procGetFeature         = hid.NewProc("HidD_GetFeature")
	procGetProductString   = hid.NewProc("HidD_GetProductString")
	procGetManufacturerStr = hid.NewProc("HidD_GetManufacturerString")
	procGetSerialString    = hid.NewProc("HidD_GetSerialNumberString")
	procGetAttributes      = hid.NewProc("HidD_GetAttributes")
	procGetCaps            = hid.NewProc("HidP_GetCaps")
	procGetButtonCaps      = hid.NewProc("HidP_GetButtonCaps")
	procGetValueCaps       = hid.NewProc("HidP_GetValueCaps")
)

const (
	capsSize       = 64
	itemCapsSize   = 72
	hidpStatusOK   = 0x00110000
	reportInput    = 0
	reportOutput   = 1
	reportFeature  = 2
	stringBufBytes = 512
)

func main() {
	path := flag.String("path", "", `device interface path, e.g. \\?\HID#VID_0FD9&PID_0080#...#{4d1e55b2-f16f-11cf-88cb-001111000030}`)
	flag.Parse()
	if *path == "" {
		flag.Usage()
		os.Exit(2)
	}

	p, err := syscall.UTF16PtrFromString(*path)
	if err != nil {
		fatal(err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		fatal(fmt.Errorf("open device: %w", err))
	}
	defer func() {
		if err := syscall.CloseHandle(h); err != nil {
			fmt.Fprintln(os.Stderr, "close device:", err)
		}
	}()

	var attrs struct {
		Size      uint32
		VendorID  uint16
		ProductID uint16
		Version   uint16
	}
	attrs.Size = uint32(unsafe.Sizeof(attrs))
	if r, _, e := procGetAttributes.Call(uintptr(h), uintptr(unsafe.Pointer(&attrs))); r == 0 { //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		fatal(fmt.Errorf("HidD_GetAttributes: %w", e))
	}
	fmt.Printf("vid=%04x pid=%04x bcdDevice=%04x\n", attrs.VendorID, attrs.ProductID, attrs.Version)
	fmt.Printf("manufacturer=%q\n", hidString(h, procGetManufacturerStr))
	fmt.Printf("product=%q\n", hidString(h, procGetProductString))
	fmt.Printf("serial=%q\n", hidString(h, procGetSerialString))

	var preparsed uintptr
	if r, _, e := procGetPreparsedData.Call(uintptr(h), uintptr(unsafe.Pointer(&preparsed))); r == 0 { //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		fatal(fmt.Errorf("HidD_GetPreparsedData: %w", e))
	}
	defer func() {
		if r, _, e := procFreePreparsedData.Call(preparsed); r == 0 {
			fmt.Fprintln(os.Stderr, "HidD_FreePreparsedData:", e)
		}
	}()

	caps := make([]byte, capsSize)
	if r, _, _ := procGetCaps.Call(preparsed, uintptr(unsafe.Pointer(&caps[0]))); r != hidpStatusOK { //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		fatal(fmt.Errorf("HidP_GetCaps: status %#x", r))
	}
	u16 := func(off int) uint16 { return binary.LittleEndian.Uint16(caps[off:]) }
	fmt.Printf("usage=%#04x usagePage=%#04x\n", u16(0), u16(2))
	fmt.Printf("inputLen=%d outputLen=%d featureLen=%d\n", u16(4), u16(6), u16(8))
	featureLen := int(u16(8))

	// Offsets of Number*ButtonCaps / Number*ValueCaps inside HIDP_CAPS.
	dumpItemCaps(preparsed, "input", reportInput, u16(46), u16(48))
	dumpItemCaps(preparsed, "output", reportOutput, u16(52), u16(54))
	dumpItemCaps(preparsed, "feature", reportFeature, u16(58), u16(60))

	if featureLen == 0 {
		return
	}
	fmt.Println("feature reports:")
	for id := 0; id < 256; id++ {
		buf := make([]byte, featureLen)
		buf[0] = byte(id)
		r, _, _ := procGetFeature.Call(uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))) //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		if r == 0 {
			continue
		}
		fmt.Printf("  id=%#02x %s\n", id, hex.EncodeToString(buf))
	}
}

func dumpItemCaps(preparsed uintptr, name string, reportType uintptr, buttons, values uint16) {
	dump := func(kind string, proc *syscall.LazyProc, n uint16) {
		if n == 0 {
			return
		}
		buf := make([]byte, int(n)*itemCapsSize)
		count := n
		r, _, _ := proc.Call(reportType, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&count)), preparsed) //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		if r != hidpStatusOK {
			fmt.Printf("%s %s caps: status %#x\n", name, kind, r)
			return
		}
		for i := 0; i < int(count); i++ {
			c := buf[i*itemCapsSize : (i+1)*itemCapsSize]
			le := binary.LittleEndian
			fmt.Printf("%s %s: reportID=%#02x usagePage=%#04x bitField=%#04x linkUsagePage=%#04x linkUsage=%#04x isRange=%d usageMin=%#04x usageMax=%#04x",
				name, kind, c[2], le.Uint16(c[0:]), le.Uint16(c[4:]), le.Uint16(c[10:]), le.Uint16(c[8:]), c[12], le.Uint16(c[56:]), le.Uint16(c[58:]))
			if kind == "value" {
				fmt.Printf(" bitSize=%d reportCount=%d logicalMin=%d logicalMax=%d",
					le.Uint16(c[18:]), le.Uint16(c[20:]), signed(le.Uint32(c[40:])), signed(le.Uint32(c[44:])))
			} else {
				fmt.Printf(" reportCount=%d", le.Uint16(c[16:]))
			}
			fmt.Println()
		}
	}
	dump("button", procGetButtonCaps, buttons)
	dump("value", procGetValueCaps, values)
}

func hidString(h syscall.Handle, proc *syscall.LazyProc) string {
	buf := make([]uint16, stringBufBytes/2)
	if r, _, _ := proc.Call(uintptr(h), uintptr(unsafe.Pointer(&buf[0])), stringBufBytes); r == 0 { //nolint:gosec // G103: HID APIs take pointers to caller-owned buffers
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// signed reinterprets v as a two's complement 32-bit value.
func signed(v uint32) int64 {
	return int64(v) - int64(v>>31)<<32
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
