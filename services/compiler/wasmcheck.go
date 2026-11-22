package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// allowedImports must match what runtime-arduino provides in `env` (and the SIM_IMPORT
// declarations in arduino-shim/include/Arduino.h; a test keeps them in sync).
var allowedImports = map[string]bool{
	"pinMode": true, "digitalWrite": true, "digitalRead": true, "analogRead": true,
	"delayMicroseconds": true, "millis": true, "micros": true,
	"simDelay": true, "simSerialWrite": true, "simPwmWrite": true, "simPwmStop": true,
	"simTone": true, "simPulseIn": true, "simAttachInterrupt": true, "simDetachInterrupt": true,
	"simI2cBegin": true, "simI2cWrite": true, "simI2cRead": true, "simSensorRead": true,
	"simMath": true,
}

func readULEB(b []byte, p int) (uint64, int, error) {
	var v uint64
	var shift uint
	for i := 0; i < 10 && p+i < len(b); i++ {
		c := b[p+i]
		v |= uint64(c&0x7f) << shift
		if c&0x80 == 0 {
			return v, i + 1, nil
		}
		shift += 7
	}
	return 0, 0, errors.New("bad LEB128")
}

// WasmImports returns "module.name" for every import in the module's import section.
func WasmImports(wasm []byte) ([]string, error) {
	if len(wasm) < 8 || string(wasm[:4]) != "\x00asm" {
		return nil, errors.New("not a wasm module")
	}
	p := 8
	for p < len(wasm) {
		id := wasm[p]
		size, n, err := readULEB(wasm, p+1)
		if err != nil {
			return nil, err
		}
		start := p + 1 + n
		end := start + int(size)
		if end > len(wasm) {
			return nil, errors.New("truncated section")
		}
		if id == 2 {
			return parseImportSection(wasm[start:end])
		}
		p = end
	}
	return nil, nil
}

func parseImportSection(b []byte) ([]string, error) {
	count, n, err := readULEB(b, 0)
	if err != nil {
		return nil, err
	}
	p := n
	readName := func() (string, error) {
		l, n, err := readULEB(b, p)
		if err != nil || p+n+int(l) > len(b) {
			return "", errors.New("bad name")
		}
		s := string(b[p+n : p+n+int(l)])
		p += n + int(l)
		return s, nil
	}
	var out []string
	for i := uint64(0); i < count; i++ {
		mod, err := readName()
		if err != nil {
			return nil, err
		}
		field, err := readName()
		if err != nil {
			return nil, err
		}
		out = append(out, mod+"."+field)
		if p >= len(b) {
			return nil, errors.New("truncated import")
		}
		kind := b[p]
		p++
		switch kind {
		case 0: // function: type index
			_, n, err := readULEB(b, p)
			if err != nil {
				return nil, err
			}
			p += n
		case 1: // table: reftype + limits
			p++
			p, err = skipLimits(b, p)
		case 2: // memory: limits
			p, err = skipLimits(b, p)
		case 3: // global: valtype + mutability
			p += 2
		default:
			return nil, fmt.Errorf("unknown import kind %d", kind)
		}
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func skipLimits(b []byte, p int) (int, error) {
	if p >= len(b) {
		return 0, errors.New("bad limits")
	}
	flag := b[p]
	p++
	_, n, err := readULEB(b, p)
	if err != nil {
		return 0, err
	}
	p += n
	if flag&1 == 1 {
		_, n, err = readULEB(b, p)
		if err != nil {
			return 0, err
		}
		p += n
	}
	return p, nil
}

// UnsupportedImports lists functions the sketch needs that the simulator does not provide.
func UnsupportedImports(wasm []byte) ([]string, error) {
	imports, err := WasmImports(wasm)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, imp := range imports {
		mod, name, _ := strings.Cut(imp, ".")
		if mod == "env" && allowedImports[name] {
			continue
		}
		set[demangle(name)] = true
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}

var digitsRe = regexp.MustCompile(`^\d+`)

// demangle turns `_ZN9WiFiClass5beginEPKc` into `WiFiClass::begin`; C names pass through.
func demangle(name string) string {
	if !strings.HasPrefix(name, "_Z") {
		return name
	}
	s := name[2:]
	s = strings.TrimPrefix(s, "N")
	var parts []string
	for {
		m := digitsRe.FindString(s)
		if m == "" {
			break
		}
		n := 0
		for _, c := range m {
			n = n*10 + int(c-'0')
		}
		s = s[len(m):]
		if n > len(s) {
			break
		}
		parts = append(parts, s[:n])
		s = s[n:]
	}
	if len(parts) == 0 {
		return name
	}
	return strings.Join(parts, "::")
}
