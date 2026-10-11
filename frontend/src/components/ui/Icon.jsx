import {
  AlertCircle, AlertTriangle, Archive, ArrowRight, ArrowUpRight, Box, Calendar,
  ChartNoAxesCombined, CheckCircle2, ChevronRight, Circle, Clock, Compass,
  Cpu, Crosshair, DoorOpen, Download, Eye, EyeOff, FileCheck, FileJson,
  FileSearch, FileText, Film, Folder, Globe, Globe2, Grid, HardDrive, Info,
  Landmark, Layers, LayoutDashboard, Lock, LockKeyhole, Map, MapPin,
  MousePointer, Pause, Play, Plus, Radar, RefreshCw, Rocket, RotateCcw, Ruler,
  Save, Search, Server, Settings, Shield, ShieldCheck, Sliders, Table, Trash2,
  Truck, Upload, UploadCloud, User, UserRound, Users, Video, VideoOff, X, Zap,
} from "lucide-react";

const ICONS = {
  AlertCircle, AlertTriangle, Archive, ArrowRight, ArrowUpRight, Box, Calendar,
  ChartNoAxesCombined, CheckCircle2, ChevronRight, Circle, Clock, Compass,
  Cpu, Crosshair, DoorOpen, Download, Eye, EyeOff, FileCheck, FileJson,
  FileSearch, FileText, Film, Folder, Globe, Globe2, Grid, HardDrive, Info,
  Landmark, Layers, LayoutDashboard, Lock, LockKeyhole, Map, MapPin,
  MousePointer, Pause, Play, Plus, Radar, RefreshCw, Rocket, RotateCcw, Ruler,
  Save, Search, Server, Settings, Shield, ShieldCheck, Sliders, Table, Trash2,
  Truck, Upload, UploadCloud, User, UserRound, Users, Video, VideoOff, X, Zap,
};

export default function Icon({ name, size = 17, ...props }) {
  const Component = ICONS[name] || Circle;
  return <Component size={size} strokeWidth={1.65} {...props} />;
}
