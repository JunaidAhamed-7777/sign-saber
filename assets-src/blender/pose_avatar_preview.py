"""Deformation check: pose the authored rig, render actual Blender previews, restore rest.

Set SIGN_SABER_POSE to one of POSES (default 'stress'). Rotations are bone-local degrees
(X flexes, Z abducts for arms/fingers with the authored rolls). Rendering reuses
render_avatar_preview.py; the rest pose is always restored, never saved.
"""
import bpy
import math
import pathlib
from mathutils import Euler

source = pathlib.Path(bpy.data.filepath).resolve()
if source.name != 'signsaber_avatar.blend' or not bpy.context.scene.get('sign_saber_asset_session'):
    raise RuntimeError('Dedicated avatar authoring file required')
rig = bpy.data.objects['avatar_rig']


def fingers(side, flex, names=('index', 'middle', 'ring', 'pinky'), thumb=None):
    out = {}
    for name in names:
        for i in range(1, 4):
            out['%s_%02d.%s' % (name, i, side)] = (flex[i - 1], 0, 0)
    if thumb:
        for i in range(1, 4):
            out['thumb_%02d.%s' % (i, side)] = thumb[i - 1]
    return out


POSES = {
    'stress': {
        # Left: arm raised to horizontal-plus, elbow flexed 120 degrees, fist.
        'upper_arm.L': (0, 0, 60),
        'forearm.L': (-120, 0, 0),
        **fingers('L', (-85, -95, -60), thumb=((-10, 0, -25), (-35, 0, 0), (-40, 0, 0))),
        # Right: arm forward, wrist twisted, pointing index.
        'upper_arm.R': (-70, 0, 0),
        'forearm.R': (-20, 70, 0),
        'hand.R': (0, 30, 0),
        **fingers('R', (-85, -95, -60), names=('middle', 'ring', 'pinky'), thumb=((-10, 0, 25), (-35, 0, 0), (-40, 0, 0))),
        'spine': (8, 10, 0),
        'neck': (0, 15, 0),
        'head': (-8, 10, 6),
    },
    'hands': {
        **fingers('L', (-80, -95, -60), thumb=((-10, 0, -20), (-30, 0, 0), (-40, 0, 0))),
        **fingers('R', (-80, -95, -60), names=('middle', 'ring', 'pinky'), thumb=((-10, 0, 20), (-30, 0, 0), (-40, 0, 0))),
        'forearm.R': (0, 60, 0),
    },
    'overhead': {
        'upper_arm.L': (0, 0, 130),
        'forearm.L': (-15, 0, 0),
        'upper_arm.R': (0, 0, -130),
        'forearm.R': (-15, 0, 0),
        'chest': (-6, 0, 0),
    },
}
pose = POSES[globals().get('SIGN_SABER_POSE', 'stress')]
saved = {}
try:
    for bone in rig.pose.bones:
        saved[bone.name] = (bone.rotation_mode, tuple(bone.rotation_quaternion), tuple(bone.rotation_euler))
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = Euler((0, 0, 0))
    for name, (x, y, z) in pose.items():
        rig.pose.bones[name].rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)))
    bpy.context.view_layer.update()
    code = (source.parent / 'render_avatar_preview.py').read_text(encoding='utf8')
    namespace = dict(globals())
    exec(compile(code, 'render_avatar_preview.py', 'exec'), namespace)
finally:
    for bone in rig.pose.bones:
        mode, quat, euler = saved.get(bone.name, ('QUATERNION', (1, 0, 0, 0), (0, 0, 0)))
        bone.rotation_mode = mode
        bone.rotation_quaternion = quat
        bone.rotation_euler = euler
    bpy.context.view_layer.update()
