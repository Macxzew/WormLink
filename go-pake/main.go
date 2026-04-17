//go:build js && wasm

package main

import (
    "encoding/base64"
    "syscall/js"

    "filippo.io/cpace"
)

var state *cpace.State

func toJSBytes(buf []byte) js.Value {
    dst := js.Global().Get("Uint8Array").New(len(buf))
    js.CopyBytesToJS(dst, buf)
    return dst
}

func start(_ js.Value, args []js.Value) interface{} {
    pass := make([]byte, args[0].Length())
    js.CopyBytesToGo(pass, args[0])

    msgA, s, err := cpace.Start(string(pass), cpace.NewContextInfo("", "", nil))
    if err != nil {
        return nil
    }
    state = s
    return base64.URLEncoding.EncodeToString(msgA)
}

func exchange(_ js.Value, args []js.Value) interface{} {
    pass := make([]byte, args[0].Length())
    js.CopyBytesToGo(pass, args[0])
    msgA, err := base64.URLEncoding.DecodeString(args[1].String())
    if err != nil {
        return []interface{}{nil, nil}
    }

    msgB, material, err := cpace.Exchange(string(pass), cpace.NewContextInfo("", "", nil), msgA)
    if err != nil {
        return []interface{}{nil, nil}
    }

    return []interface{}{
        toJSBytes(material),
        base64.URLEncoding.EncodeToString(msgB),
    }
}

func finish(_ js.Value, args []js.Value) interface{} {
    msgB, err := base64.URLEncoding.DecodeString(args[0].String())
    if err != nil || state == nil {
        return nil
    }

    material, err := state.Finish(msgB)
    if err != nil {
        return nil
    }

    return toJSBytes(material)
}

func main() {
    js.Global().Set("wormlinkPake", map[string]interface{}{
        "start":       js.FuncOf(start),
        "exchange":    js.FuncOf(exchange),
        "finish":      js.FuncOf(finish),
    })

    select {}
}
