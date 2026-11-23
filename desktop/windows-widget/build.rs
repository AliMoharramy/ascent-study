fn main() {
    println!("cargo:rerun-if-changed=ui/main.slint");
    println!("cargo:rerun-if-changed=ui/tray.slint");
    slint_build::compile("ui/main.slint").expect("compile Slint UI");
}
