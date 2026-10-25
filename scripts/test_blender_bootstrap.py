"""Offline bootstrap safety checks: python scripts/test_blender_bootstrap.py.

Mocks Blender and addon loading; does not start Blender, sockets, or a network client.
These tests verify orchestration, not upstream addon behavior or GUI compatibility.
"""
import contextlib
import io
from pathlib import Path
import runpy
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


BOOTSTRAP = Path(__file__).resolve().parents[1] / 'assets-src/blender/bootstrap.py'
PIN = '8e193a249e2ed1262f3e794ee2254efd8e3d1f0224385245f2b989154c837083'
SERVICES = ('polyhaven', 'hyper3d', 'sketchfab', 'hunyuan3d', 'polypizza', 'tripo', 'meshy')


class Scene(dict):
    """Blender scenes support both custom-property and attribute access."""


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.addon_path = self.root / 'addon.py'
        self.addon_path.write_text('# inert test fixture\n', encoding='utf-8')
        self.scene = Scene()
        self.scene.objects = []
        self.scene.unit_settings = SimpleNamespace()
        self.scene.blendermcp_auto_start_server = True
        for name in SERVICES:
            setattr(self.scene, 'blendermcp_use_' + name, True)
        self.timers = SimpleNamespace(is_registered=Mock(return_value=True), unregister=Mock())
        self.bpy = SimpleNamespace(
            data=SimpleNamespace(filepath='', is_dirty=False, objects=Mock()),
            context=SimpleNamespace(scene=self.scene),
            ops=SimpleNamespace(wm=SimpleNamespace(open_mainfile=Mock(), save_as_mainfile=Mock())),
            types=SimpleNamespace(),
            app=SimpleNamespace(timers=self.timers, version_string='test-version'),
        )
        self.server = SimpleNamespace(running=True, start=Mock())
        self.addon = SimpleNamespace(
            register=Mock(), _addon_update_check_on_startup=Mock(),
            BlenderMCPServer=Mock(return_value=self.server),
        )
        self.loader = SimpleNamespace(exec_module=Mock())
        self.spec = SimpleNamespace(name='sign_saber_blender_mcp', loader=self.loader)
        self.output = io.StringIO()

    def run_bootstrap(self, *, digest=PIN):
        argv = ['blender', '--', '--root', str(self.root), '--addon', str(self.addon_path)]
        # Patch the digest only for accepted-source fixtures; no downloaded code executes.
        with patch.dict(sys.modules, {'bpy': self.bpy}), \
                patch.object(sys, 'argv', argv), \
                patch('hashlib.sha256', return_value=SimpleNamespace(hexdigest=lambda: digest)), \
                patch('importlib.util.spec_from_file_location', return_value=self.spec), \
                patch('importlib.util.module_from_spec', return_value=self.addon), \
                contextlib.redirect_stdout(self.output):
            runpy.run_path(str(BOOTSTRAP), run_name='__bootstrap_test__')

    def assert_no_scene_or_addon_mutation(self):
        self.bpy.ops.wm.save_as_mainfile.assert_not_called()
        self.bpy.ops.wm.open_mainfile.assert_not_called()
        self.bpy.data.objects.remove.assert_not_called()
        self.loader.exec_module.assert_not_called()
        self.addon.register.assert_not_called()
        self.server.start.assert_not_called()
        self.assertNotIn('SIGN_SABER_BLENDER_MCP_READY', self.output.getvalue())

    def test_hash_mismatch_rejects_before_mutation(self):
        with self.assertRaisesRegex(RuntimeError, 'hash does not match'):
            self.run_bootstrap(digest='not-the-pinned-digest')
        self.assert_no_scene_or_addon_mutation()

    def test_dirty_scene_rejects_before_mutation(self):
        self.bpy.data.is_dirty = True
        with self.assertRaisesRegex(RuntimeError, 'untouched'):
            self.run_bootstrap()
        self.assert_no_scene_or_addon_mutation()

    def test_open_scene_rejects_before_mutation(self):
        self.bpy.data.filepath = '/user/existing.blend'
        with self.assertRaisesRegex(RuntimeError, 'untouched'):
            self.run_bootstrap()
        self.assert_no_scene_or_addon_mutation()

    def test_success_disables_updates_services_and_autostart(self):
        self.run_bootstrap()
        self.timers.unregister.assert_called_once_with(self.addon._addon_update_check_on_startup)
        self.assertFalse(self.scene.blendermcp_auto_start_server)
        for name in SERVICES:
            with self.subTest(service=name):
                self.assertFalse(getattr(self.scene, 'blendermcp_use_' + name))
        self.addon.BlenderMCPServer.assert_called_once_with(host='127.0.0.1', port=9876)
        self.server.start.assert_called_once_with()
        self.assertIn('SIGN_SABER_BLENDER_MCP_READY', self.output.getvalue())

    def test_failed_server_never_reports_ready(self):
        self.server.running = False
        with self.assertRaisesRegex(RuntimeError, 'bridge did not start'):
            self.run_bootstrap()
        self.server.start.assert_called_once_with()
        self.assertNotIn('SIGN_SABER_BLENDER_MCP_READY', self.output.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
