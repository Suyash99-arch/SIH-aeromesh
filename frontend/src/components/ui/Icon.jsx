import * as Icons from "lucide-react";
export default function Icon({ name, size = 17, ...props }) { const Component = Icons[name] || Icons.Circle; return <Component size={size} strokeWidth={1.65} {...props} />; }
