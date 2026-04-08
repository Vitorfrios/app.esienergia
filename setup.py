from __future__ import annotations

import os
import shutil
from pathlib import Path

from setuptools import Command, find_packages, setup


PROJECT_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = PROJECT_ROOT / "codigo"
ENTRY_SCRIPT = SOURCE_ROOT / "servidor.py"
DIST_DIR = PROJECT_ROOT / "dist"
WORK_DIR = PROJECT_ROOT / "build" / "pyinstaller"
SPEC_DIR = PROJECT_ROOT / "build" / "spec"
APP_NAME = "ESI-Energia"
ICON_PATH = PROJECT_ROOT / "assets" / "esi-icon.ico"
DISTRIBUTION_DOCUMENTS = (
    PROJECT_ROOT / "README.md",
    PROJECT_ROOT / "MANUAL_DO_CLIENTE.txt",
)

DATA_MAPPINGS = (
    ("codigo/public", "public"),
    ("codigo/word_templates", "word_templates"),
    ("codigo/database", "database"),
    ("codigo/json", "json"),
)

HIDDEN_IMPORTS = (
    "sitecustomize",
    "servidor_modules",
    "servidor_modules.core",
    "servidor_modules.database",
    "servidor_modules.database.repositories",
    "servidor_modules.generators",
    "servidor_modules.handlers",
    "servidor_modules.utils",
    "win32com",
    "win32com.client",
    "pythoncom",
    "pywintypes",
)

COLLECT_DATA_PACKAGES = (
    "docx",
    "docxtpl",
    "jinja2",
)


def read_requirements() -> list[str]:
    requirements_path = PROJECT_ROOT / "requirements.txt"
    requirements: list[str] = []

    for raw_line in requirements_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        requirements.append(line)

    return requirements


def copy_distribution_documents(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    for source_path in DISTRIBUTION_DOCUMENTS:
        if not source_path.exists():
            continue
        shutil.copy2(source_path, output_dir / source_path.name)


class BuildExeCommand(Command):
    description = "Gera o executavel Windows com PyInstaller."
    user_options = [
        ("clean", None, "Remove build/spec antigos antes de gerar o executavel."),
    ]
    boolean_options = ["clean"]

    def initialize_options(self) -> None:
        self.clean = True

    def finalize_options(self) -> None:
        self.clean = bool(self.clean)

    def run(self) -> None:
        try:
            import PyInstaller.__main__
        except ImportError as exc:
            raise RuntimeError(
                "PyInstaller nao esta instalado no ambiente atual. "
                "Instale-o antes de executar 'python setup.py build_exe'."
            ) from exc

        if not ENTRY_SCRIPT.exists():
            raise RuntimeError(f"Script principal nao encontrado: {ENTRY_SCRIPT}")

        if self.clean:
            for target in (WORK_DIR, SPEC_DIR, DIST_DIR / APP_NAME):
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)

        SPEC_DIR.mkdir(parents=True, exist_ok=True)
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        DIST_DIR.mkdir(parents=True, exist_ok=True)

        args = [
            "--noconfirm",
            "--clean",
            "--onedir",
            "--console",
            f"--name={APP_NAME}",
            f"--paths={SOURCE_ROOT}",
            f"--distpath={DIST_DIR}",
            f"--workpath={WORK_DIR}",
            f"--specpath={SPEC_DIR}",
            "--contents-directory=_internal",
        ]

        if ICON_PATH.exists():
            args.append(f"--icon={ICON_PATH}")

        for source, destination in DATA_MAPPINGS:
            source_path = PROJECT_ROOT / source
            if source_path.exists():
                args.append(f"--add-data={source_path}{os.pathsep}{destination}")

        env_path = PROJECT_ROOT / ".env"
        if env_path.exists():
            args.append(f"--add-data={env_path}{os.pathsep}.")

        for hidden_import in HIDDEN_IMPORTS:
            args.append(f"--hidden-import={hidden_import}")

        for package_name in COLLECT_DATA_PACKAGES:
            args.append(f"--collect-data={package_name}")

        args.append(str(ENTRY_SCRIPT))

        PyInstaller.__main__.run(args)
        copy_distribution_documents(DIST_DIR / APP_NAME)


class CleanExeCommand(Command):
    description = "Remove artefatos do build do executavel."
    user_options: list[tuple[str, str | None, str]] = []

    def initialize_options(self) -> None:
        pass

    def finalize_options(self) -> None:
        pass

    def run(self) -> None:
        for target in (WORK_DIR.parent, SPEC_DIR, DIST_DIR / APP_NAME):
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)


setup(
    name="app-esienergia",
    version="1.1.0",
    description="Servidor local e painel web do sistema ESI Energia.",
    packages=find_packages(where="codigo"),
    package_dir={"": "codigo"},
    include_package_data=True,
    install_requires=read_requirements(),
    python_requires=">=3.11",
    cmdclass={
        "build_exe": BuildExeCommand,
        "clean_exe": CleanExeCommand,
    },
)
