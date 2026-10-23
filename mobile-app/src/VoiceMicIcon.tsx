import { View } from "react-native";

/** A compact, scalable microphone pictogram built from native views. */
export default function VoiceMicIcon({ color, size = 20 }: { color: string; size?: number }) {
  const stroke = Math.max(1.5, size * 0.09);
  return (
    <View accessible={false} style={{ width: size, height: size, alignItems: "center" }}>
      <View style={{ position: "absolute", top: size * 0.06, width: size * 0.3, height: size * 0.5, borderRadius: size, backgroundColor: color }} />
      <View style={{ position: "absolute", top: size * 0.34, width: size * 0.68, height: size * 0.43, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: color, borderBottomLeftRadius: size * 0.38, borderBottomRightRadius: size * 0.38 }} />
      <View style={{ position: "absolute", top: size * 0.73, width: stroke, height: size * 0.17, borderRadius: stroke, backgroundColor: color }} />
      <View style={{ position: "absolute", bottom: size * 0.01, width: size * 0.36, height: stroke, borderRadius: stroke, backgroundColor: color }} />
    </View>
  );
}
