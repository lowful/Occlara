# Looks at what build.js made, without the app:
#   blender -b -P scripts/trainer-models/preview.py -- <file.ply> <out prefix> <views>
# <views> is a + separated list of: fp (the first person camera at the origin,
# 62 degrees up and down, looking down the Trainer's -z), fpads (the same),
# left, right, front, back, top, q, q2 (orthographic, fitted to the mesh, or
# to a part of it: right@0,-0.08,0.12@0.3 looks at that point of the Trainer's
# space, 0.3 m across).
# The .ply files come from `node scripts/trainer-models/build.js <raw> --preview <dir>`;
# they are written z up for Blender (the Trainer's x, y, z as x, -z, y).
import bpy, sys, math, mathutils

a = sys.argv[sys.argv.index('--') + 1:]
src, out, views = a[0], a[1], a[2].split('+')
size = int(a[3]) if len(a) > 3 else 900
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.ply_import(filepath=src)
ob = bpy.context.selected_objects[0]
mesh = ob.data
mat = bpy.data.materials.new('v')
ob.data.materials.append(mat)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'STUDIO'
sh.color_type = 'VERTEX'
sh.show_cavity = True
sh.show_specular_highlight = True
sc.display.render_aa = '8'
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w')
world.color = (0.05, 0.06, 0.08)
sc.world = world
sc.render.film_transparent = False
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
lo = mathutils.Vector((1e9,) * 3)
hi = mathutils.Vector((-1e9,) * 3)
for v in mesh.vertices:
    for i in range(3):
        lo[i] = min(lo[i], v.co[i])
        hi[i] = max(hi[i], v.co[i])
c = (lo + hi) / 2
span = max(hi - lo)
# Blender axes: x right, y is the Trainer's -z (so +y is forward), z up.
dirs = {'left': (-1, 0, 0), 'right': (1, 0, 0), 'front': (0, 1, 0), 'back': (0, -1, 0), 'top': (0, 0.001, 1), 'q': (-0.7, -0.8, 0.45), 'q2': (0.7, 0.8, 0.35), 'q3': (-0.8, 0.7, 0.3), 'under': (0.2, -0.3, -1)}
for spec in views:
    bits = spec.split('@')
    v = bits[0]
    if v.startswith('fp'):
        cam.data.type = 'PERSP'
        cam.data.sensor_fit = 'VERTICAL'
        cam.data.angle_y = math.radians(62)
        cam.data.clip_start = 0.01
        cam.location = (0, 0, 0)
        cam.rotation_euler = (math.radians(90), 0, 0)
        sc.render.resolution_x = int(size * 16 / 9)
        sc.render.resolution_y = size
    else:
        d = mathutils.Vector(dirs[v]).normalized()
        cam.data.type = 'ORTHO'
        at, wide = c, span * 1.1
        if len(bits) > 2:
            t = [float(x) for x in bits[1].split(',')]
            at, wide = mathutils.Vector((t[0], -t[2], t[1])), float(bits[2])
        cam.data.ortho_scale = wide
        cam.location = at + d * (span * 3 + 1)
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.resolution_x = size
        sc.render.resolution_y = size
    sc.render.filepath = f'{out}_{v}{len(bits) > 2 and "z" or ""}.png'
    bpy.ops.render.render(write_still=True)
