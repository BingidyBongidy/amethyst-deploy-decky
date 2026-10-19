"""Archives for the install smoke test: a plain mod and a FOMOD with one choice."""
import sys
import zipfile

d = sys.argv[1]

with zipfile.ZipFile(f"{d}/Plain Mod-100-1-0.zip", "w") as z:
    z.writestr("textures/plain.dds", b"DDS plain")

CONFIG = """<?xml version="1.0" encoding="UTF-8"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <moduleName>Choice Mod</moduleName>
  <installSteps order="Explicit">
    <installStep name="Pick a colour">
      <optionalFileGroups order="Explicit">
        <group name="Colour" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Red">
              <description>Red textures.</description>
              <files><folder source="red" destination="textures" /></files>
              <typeDescriptor><type name="Recommended"/></typeDescriptor>
            </plugin>
            <plugin name="Blue">
              <description>Blue textures.</description>
              <files><folder source="blue" destination="textures" /></files>
              <typeDescriptor><type name="Optional"/></typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>
"""

with zipfile.ZipFile(f"{d}/Choice Mod-200-1-0.zip", "w") as z:
    z.writestr("fomod/ModuleConfig.xml", CONFIG)
    z.writestr("red/red.dds", b"DDS red")
    z.writestr("blue/blue.dds", b"DDS blue")
